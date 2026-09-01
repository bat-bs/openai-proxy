import { TRPCError } from "@trpc/server";
import { and, asc, desc, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	requestHealthAttempts,
	requestHealthSettings,
} from "~/server/db/schema";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
	if (!ctx.session.user.isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
	return next({ ctx: { session: ctx.session } });
});

const dashboardInput = z.object({
	start: z.string().datetime({ offset: true }),
	end: z.string().datetime({ offset: true }),
});

const maxRequestHealthRetentionSeconds = 10 * 365 * 24 * 60 * 60;
const maxTimelineBuckets = 2000;
const maxBreakdownRows = 100;
const requestHealthBucketOriginMs = Date.UTC(2000, 0, 1);

type LatencySummary = {
	averageMs: number | null;
	p50Ms: number | null;
	p95Ms: number | null;
	maximumMs: number | null;
};

function bucketSecondsForRange(durationMs: number) {
	const baseBucketSeconds =
		durationMs <= 15 * 60 * 1000
			? 60
			: durationMs <= 60 * 60 * 1000
				? 5 * 60
				: durationMs <= 24 * 60 * 60 * 1000
					? 15 * 60
					: durationMs <= 7 * 24 * 60 * 60 * 1000
						? 60 * 60
						: 6 * 60 * 60;
	return Math.max(
		baseBucketSeconds,
		Math.ceil(durationMs / 1000 / maxTimelineBuckets),
	);
}

export function requestHealthBucketStartMs(
	timestampMs: number,
	bucketSeconds: number,
) {
	const bucketMs = bucketSeconds * 1000;
	return (
		requestHealthBucketOriginMs +
		Math.floor((timestampMs - requestHealthBucketOriginMs) / bucketMs) *
			bucketMs
	);
}

function parseRange(input: z.infer<typeof dashboardInput>) {
	const start = new Date(input.start);
	const end = new Date(input.end);
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date range" });
	}
	if (end <= start) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The end of the range must be after its start",
		});
	}
	if (
		end.getTime() - start.getTime() >
		maxRequestHealthRetentionSeconds * 1000
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The date range must not exceed 10 years",
		});
	}
	return {
		start,
		end,
		bucketSeconds: bucketSecondsForRange(end.getTime() - start.getTime()),
	};
}

function latencySummary(row: {
	averageMs: number | null;
	p50Ms: number | null;
	p95Ms: number | null;
	maximumMs: number | null;
}): LatencySummary {
	return {
		averageMs: row.averageMs === null ? null : Number(row.averageMs),
		p50Ms: row.p50Ms === null ? null : Number(row.p50Ms),
		p95Ms: row.p95Ms === null ? null : Number(row.p95Ms),
		maximumMs: row.maximumMs === null ? null : Number(row.maximumMs),
	};
}

function durationExpression(
	column:
		| typeof requestHealthAttempts.durationMs
		| typeof requestHealthAttempts.firstByteDurationMs,
) {
	return {
		averageMs: sql<number>`avg(${column})`,
		p50Ms: sql<number>`percentile_cont(0.50) within group (order by ${column})`,
		p95Ms: sql<number>`percentile_cont(0.95) within group (order by ${column})`,
		maximumMs: sql<number>`max(${column})`,
	};
}

function retentionSeconds(value: string) {
	const match = /^(?<amount>[1-9][0-9]*)(?<unit>[mhd])$/.exec(value.trim());
	if (!match?.groups) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Use a positive duration such as 30d, 720h, or 90m",
		});
	}
	const amount = Number(match.groups.amount);
	const multiplier =
		match.groups.unit === "d" ? 86400 : match.groups.unit === "h" ? 3600 : 60;
	const seconds = amount * multiplier;
	if (
		!Number.isSafeInteger(seconds) ||
		seconds <= 0 ||
		seconds > maxRequestHealthRetentionSeconds
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Retention duration must not exceed 10 years",
		});
	}
	return seconds;
}

function formatRetention(seconds: number) {
	if (seconds % 86400 === 0) return `${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	return `${Math.floor(seconds / 60)}m`;
}

export const serviceHealthRouter = createTRPCRouter({
	getDashboard: protectedProcedure
		.input(dashboardInput)
		.query(async ({ ctx, input }) => {
			const { start, end, bucketSeconds } = parseRange(input);
			const filter = and(
				gte(requestHealthAttempts.startedAt, start.toISOString()),
				lt(requestHealthAttempts.startedAt, end.toISOString()),
			);
			const successfulCondition = sql`(
				${requestHealthAttempts.outcome} = 'success_2xx'
				OR (
					${requestHealthAttempts.clientCancelled} = true
					AND ${requestHealthAttempts.statusCode} >= 200
					AND ${requestHealthAttempts.statusCode} < 300
				)
			)`;
			const redirectCondition = sql`(
				${requestHealthAttempts.outcome} = 'redirect_3xx'
				OR (
					${requestHealthAttempts.clientCancelled} = true
					AND ${requestHealthAttempts.statusCode} >= 300
					AND ${requestHealthAttempts.statusCode} < 400
				)
			)`;
			const clientErrorCondition = sql`(
				${requestHealthAttempts.outcome} = 'client_error_4xx'
				OR (
					${requestHealthAttempts.clientCancelled} = true
					AND ${requestHealthAttempts.statusCode} >= 400
					AND ${requestHealthAttempts.statusCode} < 500
				)
			)`;
			const serverErrorCondition = sql`(
				${requestHealthAttempts.outcome} = 'server_error_5xx'
				OR (
					${requestHealthAttempts.clientCancelled} = true
					AND ${requestHealthAttempts.statusCode} >= 500
					AND ${requestHealthAttempts.statusCode} <= 599
				)
			)`;
			const unsuccessfulCondition = sql`(
				${requestHealthAttempts.outcome} IN (
					'client_error_4xx', 'server_error_5xx', 'timeout',
					'upstream_canceled', 'transport_error'
				)
				OR (
					${requestHealthAttempts.clientCancelled} = true
					AND ${requestHealthAttempts.statusCode} >= 400
				)
			)`;
			const duration = durationExpression(requestHealthAttempts.durationMs);
			const firstByte = durationExpression(
				requestHealthAttempts.firstByteDurationMs,
			);

			const [
				summaryRow,
				statusRows,
				providerRows,
				endpointRows,
				modelRows,
				timelineRows,
			] = await Promise.all([
				ctx.db
					.select({
						total: sql<number>`count(*)::int`,
						successful: sql<number>`count(*) filter (where ${successfulCondition})::int`,
						redirects: sql<number>`count(*) filter (where ${redirectCondition})::int`,
						clientErrors: sql<number>`count(*) filter (where ${clientErrorCondition})::int`,
						serverErrors: sql<number>`count(*) filter (where ${serverErrorCondition})::int`,
						timeouts: sql<number>`count(*) filter (where ${requestHealthAttempts.outcome} = 'timeout')::int`,
						upstreamCancellations: sql<number>`count(*) filter (where ${requestHealthAttempts.outcome} = 'upstream_canceled')::int`,
						transportErrors: sql<number>`count(*) filter (where ${requestHealthAttempts.outcome} = 'transport_error')::int`,
						callerCancellations: sql<number>`count(*) filter (where ${requestHealthAttempts.clientCancelled} = true)::int`,
						unsuccessful: sql<number>`count(*) filter (where ${unsuccessfulCondition})::int`,
						duration,
						firstByte,
					})
					.from(requestHealthAttempts)
					.where(filter),
				ctx.db
					.select({
						statusCode: requestHealthAttempts.statusCode,
						outcome: sql<string>`case when ${requestHealthAttempts.statusCode} is null then ${requestHealthAttempts.outcome} else '' end`,
						count: sql<number>`count(*)::int`,
					})
					.from(requestHealthAttempts)
					.where(filter)
					.groupBy(
						requestHealthAttempts.statusCode,
						sql`case when ${requestHealthAttempts.statusCode} is null then ${requestHealthAttempts.outcome} else '' end`,
					)
					.orderBy(desc(sql`count(*)`)),
				ctx.db
					.select({
						provider: requestHealthAttempts.upstream,
						count: sql<number>`count(*)::int`,
						unsuccessful: sql<number>`count(*) filter (where ${unsuccessfulCondition})::int`,
						avgDurationMs: sql<number>`coalesce(round(avg(${requestHealthAttempts.durationMs})), 0)::int`,
					})
					.from(requestHealthAttempts)
					.where(filter)
					.groupBy(requestHealthAttempts.upstream)
					.orderBy(desc(sql`count(*)`))
					.limit(maxBreakdownRows),
				ctx.db
					.select({
						endpoint: requestHealthAttempts.endpoint,
						count: sql<number>`count(*)::int`,
						unsuccessful: sql<number>`count(*) filter (where ${unsuccessfulCondition})::int`,
					})
					.from(requestHealthAttempts)
					.where(filter)
					.groupBy(requestHealthAttempts.endpoint)
					.orderBy(desc(sql`count(*)`))
					.limit(maxBreakdownRows),
				ctx.db
					.select({
						model: sql<string>`coalesce(nullif(lower(trim(${requestHealthAttempts.model})), ''), 'Unknown')`,
						count: sql<number>`count(*)::int`,
						unsuccessful: sql<number>`count(*) filter (where ${unsuccessfulCondition})::int`,
					})
					.from(requestHealthAttempts)
					.where(filter)
					.groupBy(
						sql`coalesce(nullif(lower(trim(${requestHealthAttempts.model})), ''), 'Unknown')`,
					)
					.orderBy(desc(sql`count(*)`))
					.limit(maxBreakdownRows),
				(() => {
					const bucket = sql<string>`date_bin(${sql.raw(`interval '${bucketSeconds} seconds'`)}, ${requestHealthAttempts.startedAt}, timestamptz '2000-01-01 00:00:00+00')`;
					return ctx.db
						.select({
							bucket,
							total: sql<number>`count(*)::int`,
							successful: sql<number>`count(*) filter (where ${successfulCondition})::int`,
							unsuccessful: sql<number>`count(*) filter (where ${unsuccessfulCondition})::int`,
							callerCancellations: sql<number>`count(*) filter (where ${requestHealthAttempts.clientCancelled} = true)::int`,
							avgDurationMs: sql<number>`coalesce(round(avg(${requestHealthAttempts.durationMs})), 0)::int`,
							p95DurationMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${requestHealthAttempts.durationMs}), 0)::int`,
						})
						.from(requestHealthAttempts)
						.where(filter)
						.groupBy(bucket)
						.orderBy(asc(bucket));
				})(),
			]);

			const summary = summaryRow[0];
			const total = Number(summary?.total ?? 0);
			const unsuccessful = Number(summary?.unsuccessful ?? 0);
			const callerCancellations = Number(summary?.callerCancellations ?? 0);
			const bucketMs = bucketSeconds * 1000;
			const firstBucket = requestHealthBucketStartMs(
				start.getTime(),
				bucketSeconds,
			);
			const timelineByBucket = new Map(
				timelineRows.map((row) => [new Date(row.bucket).getTime(), row]),
			);
			const timeline = [];
			for (
				let cursor = firstBucket;
				cursor < end.getTime();
				cursor += bucketMs
			) {
				const row = timelineByBucket.get(cursor);
				timeline.push({
					bucket: new Date(cursor).toISOString(),
					total: Number(row?.total ?? 0),
					successful: Number(row?.successful ?? 0),
					unsuccessful: Number(row?.unsuccessful ?? 0),
					callerCancellations: Number(row?.callerCancellations ?? 0),
					avgDurationMs: row ? Number(row.avgDurationMs) : null,
					p95DurationMs: row ? Number(row.p95DurationMs) : null,
				});
			}

			return {
				range: {
					start: start.toISOString(),
					end: end.toISOString(),
					bucketSeconds,
				},
				totals: {
					total,
					successful: Number(summary?.successful ?? 0),
					redirects: Number(summary?.redirects ?? 0),
					clientErrors: Number(summary?.clientErrors ?? 0),
					serverErrors: Number(summary?.serverErrors ?? 0),
					timeouts: Number(summary?.timeouts ?? 0),
					upstreamCancellations: Number(summary?.upstreamCancellations ?? 0),
					transportErrors: Number(summary?.transportErrors ?? 0),
					callerCancellations,
					unsuccessful,
					failureRate: total ? (unsuccessful / total) * 100 : 0,
				},
				latency: {
					duration: latencySummary(
						summary?.duration ?? {
							averageMs: null,
							p50Ms: null,
							p95Ms: null,
							maximumMs: null,
						},
					),
					firstByte: latencySummary(
						summary?.firstByte ?? {
							averageMs: null,
							p50Ms: null,
							p95Ms: null,
							maximumMs: null,
						},
					),
				},
				statusCodes: statusRows.map((row) => ({
					statusCode: row.statusCode,
					outcome: row.outcome,
					count: Number(row.count),
				})),
				providers: providerRows.map((row) => ({
					provider: row.provider,
					count: Number(row.count),
					unsuccessful: Number(row.unsuccessful),
					avgDurationMs: Number(row.avgDurationMs),
				})),
				endpoints: endpointRows.map((row) => ({
					endpoint: row.endpoint,
					count: Number(row.count),
					unsuccessful: Number(row.unsuccessful),
				})),
				models: modelRows.map((row) => ({
					model: row.model,
					count: Number(row.count),
					unsuccessful: Number(row.unsuccessful),
				})),
				timeline,
			};
		}),
	getSettings: adminProcedure.query(async ({ ctx }) => {
		const [settings] = await ctx.db
			.select()
			.from(requestHealthSettings)
			.limit(1);
		const seconds = Number(settings?.retentionSeconds ?? 2592000n);
		return { value: formatRetention(seconds) };
	}),
	updateSettings: adminProcedure
		.input(z.object({ value: z.string().trim().min(1).max(32) }))
		.mutation(async ({ ctx, input }) => {
			const seconds = retentionSeconds(input.value);
			const cutoff = new Date(Date.now() - seconds * 1000).toISOString();
			const deleted = await ctx.db.transaction(async (tx) => {
				await tx
					.insert(requestHealthSettings)
					.values({
						id: 1,
						retentionSeconds: BigInt(seconds),
						updatedAt: new Date().toISOString(),
					})
					.onConflictDoUpdate({
						target: requestHealthSettings.id,
						set: {
							retentionSeconds: BigInt(seconds),
							updatedAt: new Date().toISOString(),
						},
					});
				const rows = await tx
					.delete(requestHealthAttempts)
					.where(lt(requestHealthAttempts.startedAt, cutoff))
					.returning({ attemptId: requestHealthAttempts.attemptId });
				return rows.length;
			});
			return { value: formatRetention(seconds), deleted };
		}),
});
