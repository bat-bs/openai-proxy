import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	apikeys,
	costs,
	reportingGroupMembers,
	reportingGroups,
	reportingGroupViewers,
	requests,
	users,
} from "~/server/db/schema";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
	if (!ctx.session.user.isAdmin) {
		throw new TRPCError({ code: "FORBIDDEN" });
	}
	return next({
		ctx: {
			session: ctx.session,
		},
	});
});

const reportRangeInput = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("daily"),
		date: z
			.string()
			.trim()
			.regex(/^\d{4}-\d{2}-\d{2}$/),
	}),
	z.object({
		type: z.literal("monthly"),
		month: z
			.string()
			.trim()
			.regex(/^\d{4}-\d{2}$/),
	}),
	z.object({
		type: z.literal("quarterly"),
		year: z.number().int().min(2000).max(2200),
		quarter: z.number().int().min(1).max(4),
	}),
	z.object({
		type: z.literal("yearly"),
		year: z.number().int().min(2000).max(2200),
	}),
]);

const normalize = (value: string | null | undefined) =>
	(value ?? "").trim().toLowerCase();

const tokenAliases = {
	input: ["input", "prompt", "input_tokens", "prompt_tokens"],
	cached: [
		"cached_input",
		"cached",
		"cache",
		"input_cached",
		"cached_input_tokens",
	],
	output: ["output", "completion", "output_tokens", "completion_tokens"],
};

const unitDivisor = (unit: "1M" | "1K" | null) => {
	if (unit === "1K") return 1_000;
	return 1_000_000;
};

const priceToCurrency = (price: number) => price / 100;

function getDateRange(input: z.infer<typeof reportRangeInput>) {
	switch (input.type) {
		case "daily": {
			const parts = input.date.split("-").map(Number);
			const year = parts[0];
			const month = parts[1];
			const day = parts[2];
			if (
				year === undefined ||
				month === undefined ||
				day === undefined ||
				!Number.isFinite(year) ||
				!Number.isFinite(month) ||
				!Number.isFinite(day)
			) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			const start = new Date(Date.UTC(year, month - 1, day));
			const end = new Date(Date.UTC(year, month - 1, day + 1));
			return { start, end };
		}
		case "monthly": {
			const parts = input.month.split("-").map(Number);
			const year = parts[0];
			const month = parts[1];
			if (
				year === undefined ||
				month === undefined ||
				!Number.isFinite(year) ||
				!Number.isFinite(month)
			) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			const start = new Date(Date.UTC(year, month - 1, 1));
			const end = new Date(Date.UTC(year, month, 1));
			return { start, end };
		}
		case "quarterly": {
			const startMonth = (input.quarter - 1) * 3;
			const start = new Date(Date.UTC(input.year, startMonth, 1));
			const end = new Date(Date.UTC(input.year, startMonth + 3, 1));
			return { start, end };
		}
		case "yearly": {
			const start = new Date(Date.UTC(input.year, 0, 1));
			const end = new Date(Date.UTC(input.year + 1, 0, 1));
			return { start, end };
		}
		default:
			return { start: new Date(0), end: new Date() };
	}
}

export const reportingRouter = createTRPCRouter({
	listGroups: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) return [];

		const baseSelect = {
			id: reportingGroups.id,
			title: reportingGroups.title,
			memberCount:
				sql<number>`coalesce(count(${reportingGroupMembers.userId}), 0)`.as(
					"memberCount",
				),
		};

		if (ctx.session.user.isAdmin) {
			const rows = await ctx.db
				.select(baseSelect)
				.from(reportingGroups)
				.leftJoin(
					reportingGroupMembers,
					eq(reportingGroupMembers.groupId, reportingGroups.id),
				)
				.groupBy(reportingGroups.id, reportingGroups.title)
				.orderBy(reportingGroups.title);

			return rows.map((row) => ({
				id: String(row.id),
				title: row.title,
				memberCount: Number(row.memberCount ?? 0),
			}));
		}

		const rows = await ctx.db
			.select(baseSelect)
			.from(reportingGroups)
			.innerJoin(
				reportingGroupViewers,
				and(
					eq(reportingGroupViewers.groupId, reportingGroups.id),
					eq(reportingGroupViewers.userId, userId),
				),
			)
			.leftJoin(
				reportingGroupMembers,
				eq(reportingGroupMembers.groupId, reportingGroups.id),
			)
			.groupBy(reportingGroups.id, reportingGroups.title)
			.orderBy(reportingGroups.title);

		return rows.map((row) => ({
			id: String(row.id),
			title: row.title,
			memberCount: Number(row.memberCount ?? 0),
		}));
	}),
	listUsers: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({ id: users.id, name: users.name })
			.from(users)
			.orderBy(sql`coalesce(${users.name}, ${users.id})`);

		return rows.map((row) => ({ id: row.id, name: row.name ?? row.id }));
	}),
	listGroupDetails: adminProcedure.query(async ({ ctx }) => {
		const groups = await ctx.db
			.select({
				id: reportingGroups.id,
				title: reportingGroups.title,
				createdBy: reportingGroups.createdBy,
				createdAt: reportingGroups.createdAt,
			})
			.from(reportingGroups)
			.orderBy(reportingGroups.title);

		const memberRows = await ctx.db
			.select({
				groupId: reportingGroupMembers.groupId,
				userId: reportingGroupMembers.userId,
			})
			.from(reportingGroupMembers);

		const viewerRows = await ctx.db
			.select({
				groupId: reportingGroupViewers.groupId,
				userId: reportingGroupViewers.userId,
			})
			.from(reportingGroupViewers);

		const membersByGroup = new Map<number, string[]>();
		for (const row of memberRows) {
			const groupId = Number(row.groupId ?? 0);
			const list = membersByGroup.get(groupId) ?? [];
			list.push(row.userId);
			membersByGroup.set(groupId, list);
		}

		const viewersByGroup = new Map<number, string[]>();
		for (const row of viewerRows) {
			const groupId = Number(row.groupId ?? 0);
			const list = viewersByGroup.get(groupId) ?? [];
			list.push(row.userId);
			viewersByGroup.set(groupId, list);
		}

		return groups.map((group) => {
			const id = Number(group.id ?? 0);
			return {
				id: String(id),
				title: group.title,
				createdBy: group.createdBy,
				createdAt: group.createdAt,
				memberIds: membersByGroup.get(id) ?? [],
				viewerIds: viewersByGroup.get(id) ?? [],
			};
		});
	}),
	createGroup: adminProcedure
		.input(
			z.object({
				title: z.string().trim().min(1).max(255),
				memberIds: z.array(z.string().trim().min(1)).default([]),
				viewerIds: z.array(z.string().trim().min(1)).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [group] = await ctx.db
				.insert(reportingGroups)
				.values({
					title: input.title,
					createdBy: ctx.session.user.id,
				})
				.returning({ id: reportingGroups.id });

			const groupId = Number(group?.id ?? 0);
			if (!groupId) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			const memberIds = Array.from(new Set(input.memberIds));
			if (memberIds.length) {
				await ctx.db.insert(reportingGroupMembers).values(
					memberIds.map((userId) => ({
						groupId,
						userId,
					})),
				);
			}

			const viewerIds = Array.from(new Set(input.viewerIds));
			if (viewerIds.length) {
				await ctx.db.insert(reportingGroupViewers).values(
					viewerIds.map((userId) => ({
						groupId,
						userId,
					})),
				);
			}

			return { id: String(groupId) };
		}),
	updateGroup: adminProcedure
		.input(
			z.object({
				id: z.string().trim().min(1),
				title: z.string().trim().min(1).max(255),
				memberIds: z.array(z.string().trim().min(1)).default([]),
				viewerIds: z.array(z.string().trim().min(1)).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const groupId = Number(input.id);
			if (!groupId) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			await ctx.db
				.update(reportingGroups)
				.set({ title: input.title })
				.where(eq(reportingGroups.id, groupId));

			await ctx.db
				.delete(reportingGroupMembers)
				.where(eq(reportingGroupMembers.groupId, groupId));
			await ctx.db
				.delete(reportingGroupViewers)
				.where(eq(reportingGroupViewers.groupId, groupId));

			const memberIds = Array.from(new Set(input.memberIds));
			if (memberIds.length) {
				await ctx.db.insert(reportingGroupMembers).values(
					memberIds.map((userId) => ({
						groupId,
						userId,
					})),
				);
			}

			const viewerIds = Array.from(new Set(input.viewerIds));
			if (viewerIds.length) {
				await ctx.db.insert(reportingGroupViewers).values(
					viewerIds.map((userId) => ({
						groupId,
						userId,
					})),
				);
			}
		}),
	deleteGroup: adminProcedure
		.input(z.object({ id: z.string().trim().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const groupId = Number(input.id);
			if (!groupId) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			await ctx.db
				.delete(reportingGroups)
				.where(eq(reportingGroups.id, groupId));
		}),
	getReport: protectedProcedure
		.input(
			z.object({
				groupId: z.string().trim().min(1),
				range: reportRangeInput,
			}),
		)
		.query(async ({ ctx, input }) => {
			const isAdmin = ctx.session.user.isAdmin;
			const viewerId = ctx.session.user.id;
			const groupId = input.groupId;
			const groupIdNumber = groupId === "all" ? null : Number(groupId);

			if (groupId === "all") {
				if (!isAdmin) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
			} else {
				if (!Number.isFinite(groupIdNumber)) {
					throw new TRPCError({ code: "BAD_REQUEST" });
				}
			}

			if (groupId !== "all" && !isAdmin) {
				const safeGroupId = groupIdNumber as number;
				const viewer = await ctx.db
					.select({ userId: reportingGroupViewers.userId })
					.from(reportingGroupViewers)
					.where(
						and(
							eq(reportingGroupViewers.groupId, safeGroupId),
							eq(reportingGroupViewers.userId, viewerId),
						),
					)
					.limit(1);
				if (!viewer.length) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
			}

			const { start, end } = getDateRange(input.range);
			const timeFilter = sql`${requests.requestTime} >= ${start.toISOString()} AND ${requests.requestTime} < ${end.toISOString()}`;
			const dayCount = Math.max(
				1,
				Math.ceil((end.getTime() - start.getTime()) / 86_400_000),
			);
			const dayCounts = Array.from({ length: 7 }, () => 0);
			for (
				const cursor = new Date(start);
				cursor < end;
				cursor.setUTCDate(cursor.getUTCDate() + 1)
			) {
				const utcDay = cursor.getUTCDay(); // 0=Sun..6=Sat
				const dayIndex = utcDay === 0 ? 6 : utcDay - 1; // 0=Mon..6=Sun
				dayCounts[dayIndex] += 1;
			}

			let scopedUserIds: string[] | null = null;
			if (groupId !== "all") {
				const safeGroupId = groupIdNumber as number;
				const members = await ctx.db
					.select({ userId: reportingGroupMembers.userId })
					.from(reportingGroupMembers)
					.where(eq(reportingGroupMembers.groupId, safeGroupId));
				scopedUserIds = members.map((row) => row.userId);
				if (!scopedUserIds.length) {
					return {
						summary: {
							inputTokens: 0,
							cachedInputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							currency: "EUR",
						},
						modelUsage: [],
						users: [],
						cumulativeCosts: [],
						hourlyTokens: Array.from({ length: 24 }, (_, hour) => ({
							hour,
							avgTokens: 0,
						})),
						hourlyOutputByDay: [],
						costsUsed: [],
					};
				}
			}

			const usersBase = ctx.db
				.select({
					userId: users.id,
					name: users.name,
					model: requests.model,
					inputTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount}), 0)`.as(
							"inputTokens",
						),
					cachedInputTokens:
						sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
							"cachedInputTokens",
						),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens",
						),
				})
				.from(users)
				.leftJoin(apikeys, eq(apikeys.owner, users.id))
				.leftJoin(
					requests,
					and(eq(requests.apiKeyId, apikeys.uuid), timeFilter),
				);

			const usageRows = await (scopedUserIds
				? usersBase.where(inArray(users.id, scopedUserIds))
				: usersBase
			).groupBy(users.id, users.name, requests.model);

			const costRows = await ctx.db
				.select({
					model: costs.model,
					price: costs.price,
					validFrom: costs.validFrom,
					tokenType: costs.tokenType,
					unitOfMessure: costs.unitOfMessure,
					currency: costs.currency,
				})
				.from(costs);

			const costIndex = new Map<
				string,
				Map<
					string,
					{
						price: number;
						validFrom: string | null;
						unit: "1M" | "1K" | null;
						currency: string | null;
						tokenType: string | null;
					}
				>
			>();

			for (const row of costRows) {
				const modelKey = normalize(row.model);
				const tokenKey = normalize(row.tokenType);
				if (!modelKey || !tokenKey) continue;
				const modelMap = costIndex.get(modelKey) ?? new Map();
				const existing = modelMap.get(tokenKey);
				const currentValidFrom = row.validFrom
					? new Date(row.validFrom).getTime()
					: 0;
				const existingValidFrom = existing?.validFrom
					? new Date(existing.validFrom).getTime()
					: 0;
				if (!existing || currentValidFrom >= existingValidFrom) {
					modelMap.set(tokenKey, {
						price: Number(row.price ?? 0),
						validFrom: row.validFrom ?? null,
						unit: (row.unitOfMessure ?? null) as "1M" | "1K" | null,
						currency: row.currency ? row.currency.trim().toUpperCase() : null,
						tokenType: row.tokenType ?? null,
					});
				}
				costIndex.set(modelKey, modelMap);
			}

			const usedCosts = new Map<
				string,
				{
					model: string;
					tokenType: string;
					price: number;
					unit: "1M" | "1K" | null;
					currency: string | null;
					validFrom: string | null;
				}
			>();

			const registerUsedCost = (
				model: string,
				tokenKey: string,
				entry: {
					price: number;
					validFrom: string | null;
					unit: "1M" | "1K" | null;
					currency: string | null;
					tokenType: string | null;
				},
			) => {
				const key = `${normalize(model)}::${tokenKey}`;
				if (usedCosts.has(key)) return;
				usedCosts.set(key, {
					model,
					tokenType: entry.tokenType ?? tokenKey,
					price: entry.price,
					unit: entry.unit,
					currency: entry.currency,
					validFrom: entry.validFrom,
				});
			};

			const calcTokenCost = (
				model: string,
				tokens: number,
				aliases: string[],
			) => {
				if (tokens <= 0) return { cost: 0, missing: false, currency: null };
				const modelKey = normalize(model);
				const modelMap = costIndex.get(modelKey);
				if (!modelMap) return { cost: 0, missing: true, currency: null };
				let entry:
					| {
							price: number;
							validFrom: string | null;
							unit: "1M" | "1K" | null;
							currency: string | null;
							tokenType: string | null;
					  }
					| undefined;
				let matchedKey: string | null = null;
				for (const alias of aliases) {
					entry = modelMap.get(alias);
					if (entry) {
						matchedKey = alias;
						break;
					}
				}
				if (!entry) return { cost: 0, missing: true, currency: null };
				if (matchedKey) {
					registerUsedCost(model, matchedKey, entry);
				}
				return {
					cost:
						(tokens / unitDivisor(entry.unit)) * priceToCurrency(entry.price),
					missing: false,
					currency: entry.currency,
				};
			};

			const scopedConditions = [timeFilter];
			if (scopedUserIds) {
				scopedConditions.push(inArray(apikeys.owner, scopedUserIds));
			}
			const scopedFilter = and(...scopedConditions);

			const costBucket =
				input.range.type === "daily"
					? sql<string>`date_trunc('hour', ${requests.requestTime})`
					: sql<string>`date_trunc('day', ${requests.requestTime})`;

			const costRowsByBucket = await ctx.db
				.select({
					bucket: costBucket.as("bucket"),
					model: requests.model,
					inputTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount}), 0)`.as(
							"inputTokens",
						),
					cachedInputTokens:
						sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
							"cachedInputTokens",
						),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens",
						),
				})
				.from(requests)
				.leftJoin(apikeys, eq(apikeys.uuid, requests.apiKeyId))
				.where(scopedFilter)
				.groupBy(costBucket, requests.model);

			const costBuckets = new Map<
				string,
				{
					date: Date;
					cost: number;
					currency: string | null;
					missing: boolean;
				}
			>();

			for (const row of costRowsByBucket) {
				const model = row.model ?? null;
				const inputTokens = Number(row.inputTokens ?? 0);
				const cachedTokens = Number(row.cachedInputTokens ?? 0);
				const outputTokens = Number(row.outputTokens ?? 0);

				if (!model || inputTokens + cachedTokens + outputTokens <= 0) {
					continue;
				}

				const bucketValue = row.bucket;
				if (!bucketValue) continue;
				const bucketDate = new Date(bucketValue);
				const bucketKey = bucketDate.toISOString();

				const inputCost = calcTokenCost(model, inputTokens, tokenAliases.input);
				const cachedCost = calcTokenCost(
					model,
					cachedTokens,
					tokenAliases.cached,
				);
				const outputCost = calcTokenCost(
					model,
					outputTokens,
					tokenAliases.output,
				);

				const modelMissing =
					inputCost.missing || cachedCost.missing || outputCost.missing;
				const currencies = [
					inputCost.currency,
					cachedCost.currency,
					outputCost.currency,
				].filter((value): value is string => Boolean(value));
				const modelCurrency =
					currencies.length > 0 &&
					currencies.every((value) => value === currencies[0])
						? (currencies[0] ?? null)
						: null;
				const modelCost = modelMissing
					? null
					: inputCost.cost + cachedCost.cost + outputCost.cost;

				const bucket = costBuckets.get(bucketKey) ?? {
					date: bucketDate,
					cost: 0,
					currency: null,
					missing: false,
				};

				if (modelCost === null) {
					bucket.missing = true;
				} else {
					bucket.cost += modelCost;
					if (bucket.currency === null) {
						bucket.currency = modelCurrency;
					} else if (modelCurrency && bucket.currency !== modelCurrency) {
						bucket.currency = null;
					}
				}

				costBuckets.set(bucketKey, bucket);
			}

			const cumulativeCosts = Array.from(costBuckets.values())
				.sort((a, b) => a.date.getTime() - b.date.getTime())
				.map((bucket) => ({
					date: bucket.date.toISOString(),
					cost: bucket.missing ? null : bucket.cost,
				}));

			let runningCost = 0;
			let runningMissing = false;
			const cumulativeCostSeries = cumulativeCosts.map((bucket) => {
				if (runningMissing || bucket.cost === null) {
					runningMissing = true;
					return { date: bucket.date, cumulativeCost: null };
				}
				runningCost += bucket.cost;
				return { date: bucket.date, cumulativeCost: runningCost };
			});

			const hourBucket = sql<number>`extract(hour from ${requests.requestTime})`;
			const hourlyRows = await ctx.db
				.select({
					hour: hourBucket.as("hour"),
					totalTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.cachedInputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"totalTokens",
						),
				})
				.from(requests)
				.leftJoin(apikeys, eq(apikeys.uuid, requests.apiKeyId))
				.where(scopedFilter)
				.groupBy(hourBucket);

			const hourlyTotals = new Map<number, number>();
			for (const row of hourlyRows) {
				const hour = Number(row.hour ?? 0);
				hourlyTotals.set(hour, Number(row.totalTokens ?? 0));
			}

			const hourlyTokens = Array.from({ length: 24 }, (_, hour) => ({
				hour,
				avgTokens: (hourlyTotals.get(hour) ?? 0) / dayCount,
			}));

			const dayBucket = sql<number>`extract(dow from ${requests.requestTime})`;
			const hourlyDayRows = await ctx.db
				.select({
					day: dayBucket.as("day"),
					hour: hourBucket.as("hour"),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens",
						),
				})
				.from(requests)
				.leftJoin(apikeys, eq(apikeys.uuid, requests.apiKeyId))
				.where(scopedFilter)
				.groupBy(dayBucket, hourBucket);

			const dayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
			const dayHourTotals = new Map<string, number>();
			for (const row of hourlyDayRows) {
				const rawDay = Number(row.day ?? 0);
				const dayIndex = rawDay === 0 ? 6 : rawDay - 1;
				const hour = Number(row.hour ?? 0);
				dayHourTotals.set(
					`${dayIndex}-${hour}`,
					Number(row.outputTokens ?? 0),
				);
			}

			const hourlyOutputByDay = Array.from({ length: 7 }, (_, dayIndex) => {
				const dayLabel = dayLabels[dayIndex] ?? String(dayIndex);
				const divisor = dayCounts[dayIndex] || 0;
				return Array.from({ length: 24 }, (_, hour) => ({
					dayIndex,
					dayLabel,
					hour,
					outputTokens:
						divisor > 0
							? (dayHourTotals.get(`${dayIndex}-${hour}`) ?? 0) / divisor
							: 0,
				}));
			}).flat();

			const usersMap = new Map<
				string,
				{
					id: string;
					name: string;
					inputTokens: number;
					cachedInputTokens: number;
					outputTokens: number;
					totalCost: number | null;
					currency: string | null;
					models: Array<{
						model: string;
						inputTokens: number;
						cachedInputTokens: number;
						outputTokens: number;
						inputCost: number | null;
						cachedCost: number | null;
						outputCost: number | null;
						totalCost: number | null;
						currency: string | null;
					}>;
				}
			>();

			const modelTotals = new Map<string, number>();
			let totalInputTokens = 0;
			let totalCachedTokens = 0;
			let totalOutputTokens = 0;
			let totalCost = 0;
			let totalCurrency: string | null = null;

			for (const row of usageRows) {
				const id = row.userId;
				const entry = usersMap.get(id) ?? {
					id,
					name: row.name ?? id,
					inputTokens: 0,
					cachedInputTokens: 0,
					outputTokens: 0,
					totalCost: 0,
					currency: null,
					models: [],
				};

				const inputTokens = Number(row.inputTokens ?? 0);
				const cachedTokens = Number(row.cachedInputTokens ?? 0);
				const outputTokens = Number(row.outputTokens ?? 0);

				entry.inputTokens += inputTokens;
				entry.cachedInputTokens += cachedTokens;
				entry.outputTokens += outputTokens;

				totalInputTokens += inputTokens;
				totalCachedTokens += cachedTokens;
				totalOutputTokens += outputTokens;

				const model = row.model ?? null;
				if (model && inputTokens + cachedTokens + outputTokens > 0) {
					const inputCost = calcTokenCost(
						model,
						inputTokens,
						tokenAliases.input,
					);
					const cachedCost = calcTokenCost(
						model,
						cachedTokens,
						tokenAliases.cached,
					);
					const outputCost = calcTokenCost(
						model,
						outputTokens,
						tokenAliases.output,
					);

					const modelMissing =
						inputCost.missing || cachedCost.missing || outputCost.missing;
					const currencies = [
						inputCost.currency,
						cachedCost.currency,
						outputCost.currency,
					].filter((value): value is string => Boolean(value));
					const modelCurrency =
						currencies.length > 0 &&
						currencies.every((value) => value === currencies[0])
							? (currencies[0] ?? null)
							: null;
					const modelCost = modelMissing
						? null
						: inputCost.cost + cachedCost.cost + outputCost.cost;

					entry.models.push({
						model,
						inputTokens,
						cachedInputTokens: cachedTokens,
						outputTokens,
						inputCost: modelMissing ? null : inputCost.cost,
						cachedCost: modelMissing ? null : cachedCost.cost,
						outputCost: modelMissing ? null : outputCost.cost,
						totalCost: modelCost,
						currency: modelCost === null ? null : modelCurrency,
					});

					if (modelCost !== null) {
						entry.totalCost += modelCost;
						if (entry.currency === null) {
							entry.currency = modelCurrency;
						} else if (modelCurrency && entry.currency !== modelCurrency) {
							entry.currency = null;
						}
					} else {
						entry.currency = null;
					}

					modelTotals.set(model, (modelTotals.get(model) ?? 0) + outputTokens);

					if (modelCost !== null) {
						totalCost += modelCost;
						if (totalCurrency === null) {
							totalCurrency = modelCurrency;
						} else if (modelCurrency && totalCurrency !== modelCurrency) {
							totalCurrency = null;
						}
					} else {
						totalCurrency = null;
					}
				}

				usersMap.set(id, entry);
			}

			const usersData = Array.from(usersMap.values()).map((user) => ({
				...user,
				models: user.models.sort((a, b) => a.model.localeCompare(b.model)),
			}));

			const costsUsed = Array.from(usedCosts.values()).sort((a, b) => {
				const modelSort = a.model.localeCompare(b.model);
				if (modelSort !== 0) return modelSort;
				return a.tokenType.localeCompare(b.tokenType);
			});

			return {
				summary: {
					inputTokens: totalInputTokens,
					cachedInputTokens: totalCachedTokens,
					outputTokens: totalOutputTokens,
					totalCost: totalCost ?? null,
					currency: totalCurrency ?? null,
				},
				modelUsage: Array.from(modelTotals.entries())
					.map(([model, outputTokens]) => ({
						model,
						outputTokens,
					}))
					.sort((a, b) => b.outputTokens - a.outputTokens),
				users: usersData,
				cumulativeCosts: cumulativeCostSeries,
				hourlyTokens,
				hourlyOutputByDay,
				costsUsed,
			};
		}),
});
