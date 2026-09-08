import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	addCurrencyTotal,
	createBreakdownCostAggregate,
	createCurrencyTotals,
	createTotalCostAggregate,
	mergeCurrencyState,
	presentBreakdownCost,
	presentCurrencyTotals,
	scaledCostToNumber,
} from "~/server/costAggregation";
import {
	apikeys,
	reportingGroupMembers,
	reportingGroups,
	reportingGroupViewers,
	requestStatisticsCache,
	requestStatisticsCacheBuckets,
	users,
} from "~/server/db/schema";
import {
	ensureRequestStatisticsCache,
	mergeCachedBreakdownCost,
	mergeCachedTotalCost,
	rebuildRequestStatisticsCache,
} from "~/server/requestStatisticsCache";

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
		type: z.literal("live"),
		start: z.string().datetime({ offset: true }),
	}),
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

function getDateRange(
	input: z.infer<typeof reportRangeInput>,
	now = new Date(),
) {
	switch (input.type) {
		case "live": {
			const start = new Date(input.start);
			if (!Number.isFinite(start.getTime()) || start >= now) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			return { start, end: now, isLive: true };
		}
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
			return { start, end, isLive: false };
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
			return { start, end, isLive: false };
		}
		case "quarterly": {
			const startMonth = (input.quarter - 1) * 3;
			const start = new Date(Date.UTC(input.year, startMonth, 1));
			const end = new Date(Date.UTC(input.year, startMonth + 3, 1));
			return { start, end, isLive: false };
		}
		case "yearly": {
			const start = new Date(Date.UTC(input.year, 0, 1));
			const end = new Date(Date.UTC(input.year + 1, 0, 1));
			return { start, end, isLive: false };
		}
		default:
			return { start: new Date(0), end: now, isLive: false };
	}
}

export const reportingRouter = createTRPCRouter({
	listMyApiKeys: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: apikeys.uuid,
				description: apikeys.description,
				deactivated: apikeys.deactivated,
			})
			.from(apikeys)
			.where(eq(apikeys.owner, ctx.session.user.id));
	}),
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
				apiKeyIds: z.array(z.string().trim().min(1)).default([]),
				allApiKeys: z.boolean().default(true),
			}),
		)
		.query(async ({ ctx, input }) => {
			const isAdmin = ctx.session.user.isAdmin;
			const viewerId = ctx.session.user.id;
			const groupId = input.groupId;
			const groupIdNumber = groupId === "all" ? null : Number(groupId);
			const selfReport = groupId === "self";
			let selectedApiKeyIds: string[] = [];
			if (selfReport) {
				const ownedKeys = await ctx.db
					.select({ id: apikeys.uuid })
					.from(apikeys)
					.where(eq(apikeys.owner, viewerId));
				const ownedIds = new Set(ownedKeys.map((key) => key.id));
				selectedApiKeyIds = input.allApiKeys
					? Array.from(ownedIds)
					: Array.from(
							new Set(input.apiKeyIds.filter((id) => ownedIds.has(id))),
						);
			}

			if (groupId === "all") {
				if (!isAdmin) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
			} else {
				if (!selfReport && !Number.isFinite(groupIdNumber)) {
					throw new TRPCError({ code: "BAD_REQUEST" });
				}
			}

			if (groupId !== "all" && !selfReport && !isAdmin) {
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

			const { start, end, isLive } = getDateRange(input.range);
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
				dayCounts[dayIndex] = (dayCounts[dayIndex] ?? 0) + 1;
			}

			let scopedUserIds: string[] | null = null;
			if (selfReport) {
				scopedUserIds = [viewerId];
			} else if (groupId !== "all") {
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
							cacheWriteTokens: 0,
							outputTokens: 0,
							searchUnits: 0,
							totalCost: 0,
							currency: "EUR",
							currencyTotals: [],
							currencyIssue: false,
							hasMissingCosts: false,
						},
						modelUsage: [],
						users: [],
						cumulativeCosts: { currencies: [], points: [] },
						hourlyTokens: Array.from({ length: 24 }, (_, hour) => ({
							hour,
							avgTokens: 0,
						})),
						hourlyOutputByDay: [],
						costsUsed: [],
					};
				}
			}

			await ensureRequestStatisticsCache(ctx.db, start, end, {
				refreshCurrentBucket: isLive,
			});

			type UserModel = {
				model: string;
				requestType: string;
				inputTokens: number;
				cachedInputTokens: number;
				cacheWriteTokens: number;
				outputTokens: number;
				searchUnits: number;
				inputCost: number | null;
				cachedCost: number | null;
				cacheWriteCost: number | null;
				outputCost: number | null;
				searchCost: number | null;
				totalCost: number | null;
				currency: string | null;
				currencyIssue: boolean;
				currencyTotals: Array<{ currency: string; totalCost: number }>;
			};
			type UserEntry = {
				id: string;
				name: string;
				inputTokens: number;
				cachedInputTokens: number;
				cacheWriteTokens: number;
				outputTokens: number;
				searchUnits: number;
				totalCostScaled: bigint;
				totalCostHasKnownCost: boolean;
				totalCostHasMissingCost: boolean;
				currencyIssue: boolean;
				currency: string | null;
				currencyTotals: Map<string, bigint>;
				models: UserModel[];
			};
			const usersMap = new Map<string, UserEntry>();
			const usageMap = new Map<
				string,
				{
					userId: string;
					name: string;
					model: string | null;
					requestType:
						| (typeof requestStatisticsCache.requestType.enumValues)[number]
						| null;
					inputTokens: number;
					cachedInputTokens: number;
					cacheWriteTokens: number;
					outputTokens: number;
					searchUnits: number;
				}
			>();
			const emptyUser = (id: string, name: string): UserEntry => ({
				id,
				name,
				inputTokens: 0,
				cachedInputTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				searchUnits: 0,
				totalCostScaled: 0n,
				totalCostHasKnownCost: false,
				totalCostHasMissingCost: false,
				currencyIssue: false,
				currency: null,
				currencyTotals: createCurrencyTotals(),
				models: [],
			});
			const reportUsers = await ctx.db
				.select({ id: users.id, name: users.name })
				.from(users)
				.where(scopedUserIds ? inArray(users.id, scopedUserIds) : undefined);
			for (const user of reportUsers) {
				usersMap.set(user.id, emptyUser(user.id, user.name ?? user.id));
			}
			if (selfReport) {
				const keyRows = await ctx.db
					.select({
						id: apikeys.uuid,
						description: apikeys.description,
						deactivated: apikeys.deactivated,
					})
					.from(apikeys)
					.where(
						and(
							eq(apikeys.owner, viewerId),
							input.allApiKeys
								? sql`true`
								: selectedApiKeyIds.length
									? inArray(apikeys.uuid, selectedApiKeyIds)
									: sql`false`,
						),
					);
				usersMap.clear();
				for (const key of keyRows) {
					usersMap.set(
						key.id,
						emptyUser(
							key.id,
							`${key.description?.trim() || `API-Schlüssel ${key.id.slice(0, 8)}`}${key.deactivated ? " (deaktiviert)" : ""}`,
						),
					);
				}
			}
			const hourlyTotals = new Map<number, number>();
			const dayHourTotals = new Map<string, number>();

			const usedCosts = new Map<
				string,
				{
					model: string;
					tokenType: string;
					billingUnit: "TOKENS" | "SEARCHES";
					price: number;
					unit: "1M" | "1K" | null;
					currency: string | null;
					validFrom: string | null;
				}
			>();

			const costBuckets = new Map<
				string,
				ReturnType<typeof createTotalCostAggregate> & { date: Date }
			>();

			const costAggByUserModel = new Map<
				string,
				ReturnType<typeof createBreakdownCostAggregate>
			>();
			const reportCurrencyTotals = createCurrencyTotals();

			const cacheConditions = [
				gte(requestStatisticsCache.bucketStart, start.toISOString()),
				lt(requestStatisticsCache.bucketStart, end.toISOString()),
				isNull(requestStatisticsCacheBuckets.invalidatedAt),
			];
			if (scopedUserIds) {
				cacheConditions.push(inArray(apikeys.owner, scopedUserIds));
			}
			if (selfReport && !input.allApiKeys && selectedApiKeyIds.length > 0) {
				cacheConditions.push(
					inArray(requestStatisticsCache.apiKeyId, selectedApiKeyIds),
				);
			}
			if (selfReport && !input.allApiKeys && selectedApiKeyIds.length === 0) {
				cacheConditions.push(sql`false`);
			}
			const requestRowsForCost = await ctx.db
				.select({
					bucketStart: requestStatisticsCache.bucketStart,
					apiKeyId: requestStatisticsCache.apiKeyId,
					userId: users.id,
					model: sql<
						string | null
					>`NULLIF(${requestStatisticsCache.model}, '')`.as("model"),
					requestTime: requestStatisticsCache.bucketStart,
					inputTokenCount: requestStatisticsCache.inputTokenCount,
					cachedInputTokenCount: requestStatisticsCache.cachedInputTokenCount,
					cacheWriteTokenCount: requestStatisticsCache.cacheWriteTokenCount,
					outputTokenCount: requestStatisticsCache.outputTokenCount,
					requestType: requestStatisticsCache.requestType,
					searchUnits: requestStatisticsCache.searchUnits,
					requestCount: requestStatisticsCache.requestCount,
					totalCostScaled: requestStatisticsCache.totalCostScaled,
					inputCostScaled: requestStatisticsCache.inputCostScaled,
					cachedCostScaled: requestStatisticsCache.cachedCostScaled,
					cacheWriteCostScaled: requestStatisticsCache.cacheWriteCostScaled,
					outputCostScaled: requestStatisticsCache.outputCostScaled,
					searchCostScaled: requestStatisticsCache.searchCostScaled,
					currency: requestStatisticsCache.currency,
					currencyTotals: requestStatisticsCache.currencyTotals,
					missingCost: requestStatisticsCache.missingCost,
					currencyIssue: requestStatisticsCache.currencyIssue,
					usedCosts: requestStatisticsCache.usedCosts,
				})
				.from(requestStatisticsCache)
				.innerJoin(
					requestStatisticsCacheBuckets,
					eq(
						requestStatisticsCacheBuckets.bucketStart,
						requestStatisticsCache.bucketStart,
					),
				)
				.innerJoin(apikeys, eq(apikeys.uuid, requestStatisticsCache.apiKeyId))
				.innerJoin(users, eq(apikeys.owner, users.id))
				.where(and(...cacheConditions));

			for (const row of requestRowsForCost) {
				if (!row.requestTime) continue;
				const user = usersMap.get(selfReport ? row.apiKeyId : row.userId);
				if (user) {
					const inputTokenCount = Number(row.inputTokenCount ?? 0);
					const cachedInputTokenCount = Number(row.cachedInputTokenCount ?? 0);
					const cacheWriteTokens = Number(row.cacheWriteTokenCount ?? 0);
					const outputTokenCount = Number(row.outputTokenCount ?? 0);
					const searchUnits = Number(row.searchUnits ?? 0);
					const reportEntityId = selfReport ? row.apiKeyId : row.userId;
					const usageKey = `${reportEntityId}::${row.model ?? ""}::${row.requestType ?? ""}`;
					const usage = usageMap.get(usageKey) ?? {
						userId: reportEntityId,
						name: selfReport
							? (usersMap.get(reportEntityId)?.name ?? reportEntityId)
							: user.name,
						model: row.model,
						requestType: row.requestType,
						inputTokens: 0,
						cachedInputTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 0,
						searchUnits: 0,
					};
					usage.inputTokens +=
						inputTokenCount - cachedInputTokenCount - cacheWriteTokens;
					usage.cachedInputTokens += cachedInputTokenCount;
					usage.cacheWriteTokens += cacheWriteTokens;
					usage.outputTokens += outputTokenCount;
					usage.searchUnits += searchUnits;
					usageMap.set(usageKey, usage);

					const requestDate = new Date(row.requestTime);
					const hour = requestDate.getUTCHours();
					hourlyTotals.set(
						hour,
						(hourlyTotals.get(hour) ?? 0) +
							inputTokenCount +
							cachedInputTokenCount +
							outputTokenCount,
					);
					const rawDay = requestDate.getUTCDay();
					const dayIndex = rawDay === 0 ? 6 : rawDay - 1;
					const dayHourKey = `${dayIndex}-${hour}`;
					dayHourTotals.set(
						dayHourKey,
						(dayHourTotals.get(dayHourKey) ?? 0) + outputTokenCount,
					);
				}

				const model = row.model ?? null;
				// Keep parity with the uncached report: requests without a model
				// contribute to user/token totals, but not to cost/model buckets.
				if (!model) continue;

				const inputTokenCount = Number(row.inputTokenCount ?? 0);
				const cachedInputTokenCount = Number(row.cachedInputTokenCount ?? 0);
				const cacheWriteTokens = Number(row.cacheWriteTokenCount ?? 0);
				const outputTokenCount = Number(row.outputTokenCount ?? 0);
				const searchUnits = Number(row.searchUnits ?? 0);
				if (
					inputTokenCount +
						cachedInputTokenCount +
						cacheWriteTokens +
						outputTokenCount +
						searchUnits <=
					0
				)
					continue;

				const hourDate = new Date(row.requestTime);
				const bucketDate =
					input.range.type === "daily"
						? hourDate
						: new Date(
								Date.UTC(
									hourDate.getUTCFullYear(),
									hourDate.getUTCMonth(),
									hourDate.getUTCDate(),
								),
							);
				const bucketKey = bucketDate.toISOString();
				const bucket = costBuckets.get(bucketKey) ?? {
					date: bucketDate,
					...createTotalCostAggregate(),
				};
				mergeCachedTotalCost(bucket, row);
				costBuckets.set(bucketKey, bucket);

				if (!row.missingCost) {
					for (const usedCost of row.usedCosts ?? []) {
						if (!usedCost || typeof usedCost !== "object") continue;
						const detail = usedCost as {
							model?: string;
							tokenType?: string;
							billingUnit?: "TOKENS" | "SEARCHES";
							price?: number;
							unit?: "1M" | "1K" | null;
							currency?: string | null;
							validFrom?: string | null;
						};
						if (
							typeof detail.model !== "string" ||
							typeof detail.tokenType !== "string" ||
							typeof detail.billingUnit !== "string" ||
							typeof detail.price !== "number"
						)
							continue;
						const key = `${normalize(detail.model)}::${detail.tokenType}::${detail.validFrom ?? null}`;
						usedCosts.set(key, {
							model: detail.model,
							tokenType: detail.tokenType,
							billingUnit: detail.billingUnit,
							price: detail.price,
							unit: detail.unit ?? null,
							currency: detail.currency ?? null,
							validFrom: detail.validFrom ?? null,
						});
					}
				}

				const userId = selfReport ? row.apiKeyId : row.userId;
				const userModelKey = `${userId}::${model}::${row.requestType}`;
				const agg =
					costAggByUserModel.get(userModelKey) ??
					createBreakdownCostAggregate();
				mergeCachedBreakdownCost(agg, row);
				costAggByUserModel.set(userModelKey, agg);
			}

			const cumulativeCosts = Array.from(costBuckets.values()).sort(
				(a, b) => a.date.getTime() - b.date.getTime(),
			);
			const cumulativeCurrencies = Array.from(
				new Set(
					cumulativeCosts.flatMap((bucket) =>
						presentCurrencyTotals(bucket.currencyTotals).map(
							({ currency }) => currency,
						),
					),
				),
			).sort();
			const runningCosts = new Map<string, number>();
			let runningMissing = false;
			const cumulativeCostPoints = cumulativeCosts.map((bucket) => {
				if (runningMissing || bucket.missing) {
					runningMissing = true;
					return {
						date: bucket.date.toISOString(),
						...Object.fromEntries(
							cumulativeCurrencies.map((currency) => [currency, null]),
						),
					};
				}
				for (const { currency, totalCost } of presentCurrencyTotals(
					bucket.currencyTotals,
				)) {
					runningCosts.set(
						currency,
						(runningCosts.get(currency) ?? 0) + totalCost,
					);
				}
				return {
					date: bucket.date.toISOString(),
					...Object.fromEntries(
						cumulativeCurrencies.map((currency) => [
							currency,
							runningCosts.get(currency) ?? 0,
						]),
					),
				};
			});

			const hourlyTokens = Array.from({ length: 24 }, (_, hour) => ({
				hour,
				avgTokens: (hourlyTotals.get(hour) ?? 0) / dayCount,
			}));

			const dayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

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

			const modelTotals = new Map<
				string,
				{
					model: string;
					requestType: string;
					outputTokens: number;
					searchUnits: number;
				}
			>();
			let totalInputTokens = 0;
			let totalCachedTokens = 0;
			let totalCacheWriteTokens = 0;
			let totalOutputTokens = 0;
			let totalSearchUnits = 0;
			let totalCostScaled = 0n;
			let totalCostHasKnownCost = false;
			let totalCostHasMissingCost = false;
			let totalCurrencyIssue = false;
			let totalCurrency: string | null = null;

			const usageRows = Array.from(usageMap.values()).map((row) => ({
				...row,
				inputTokens: Math.max(0, row.inputTokens),
			}));

			for (const row of usageRows) {
				const id = row.userId;
				const entry = usersMap.get(id);
				if (!entry) continue;

				const inputTokens = Number(row.inputTokens ?? 0);
				const cachedTokens = Number(row.cachedInputTokens ?? 0);
				const cacheWriteTokens = Number(row.cacheWriteTokens ?? 0);
				const outputTokens = Number(row.outputTokens ?? 0);
				const searchUnits = Number(row.searchUnits ?? 0);

				entry.inputTokens += inputTokens;
				entry.cachedInputTokens += cachedTokens;
				entry.cacheWriteTokens += cacheWriteTokens;
				entry.outputTokens += outputTokens;
				entry.searchUnits += searchUnits;

				totalInputTokens += inputTokens;
				totalCachedTokens += cachedTokens;
				totalCacheWriteTokens += cacheWriteTokens;
				totalOutputTokens += outputTokens;
				totalSearchUnits += searchUnits;

				const model = row.model ?? null;
				if (
					model &&
					inputTokens +
						cachedTokens +
						cacheWriteTokens +
						outputTokens +
						searchUnits >
						0
				) {
					const userModelKey = `${id}::${model}::${row.requestType}`;
					const agg = costAggByUserModel.get(userModelKey);
					const modelCostPresentation = presentBreakdownCost(agg);
					for (const currencyTotal of modelCostPresentation.currencyTotals) {
						addCurrencyTotal(
							entry.currencyTotals,
							currencyTotal.currency,
							currencyTotal.totalCost,
						);
						addCurrencyTotal(
							reportCurrencyTotals,
							currencyTotal.currency,
							currencyTotal.totalCost,
						);
					}

					const modelTotalKey = `${model}::${row.requestType}`;
					const modelTotal = modelTotals.get(modelTotalKey) ?? {
						model,
						requestType: row.requestType ?? "CHAT_COMPLETION",
						outputTokens: 0,
						searchUnits: 0,
					};
					modelTotal.outputTokens += outputTokens;
					modelTotal.searchUnits += searchUnits;
					modelTotals.set(modelTotalKey, modelTotal);

					if (!agg || modelCostPresentation.missing) {
						entry.models.push({
							model,
							requestType: row.requestType ?? "CHAT_COMPLETION",
							inputTokens,
							cachedInputTokens: cachedTokens,
							cacheWriteTokens,
							outputTokens,
							searchUnits,
							inputCost: null,
							cachedCost: null,
							cacheWriteCost: null,
							outputCost: null,
							searchCost: null,
							totalCost: null,
							currency: null,
							currencyIssue: false,
							currencyTotals: modelCostPresentation.currencyTotals,
						});
						entry.totalCostHasMissingCost = true;
						totalCostHasMissingCost = true;
					} else if (modelCostPresentation.currencyIssue) {
						entry.models.push({
							model,
							requestType: row.requestType ?? "CHAT_COMPLETION",
							inputTokens,
							cachedInputTokens: cachedTokens,
							cacheWriteTokens,
							outputTokens,
							searchUnits,
							inputCost: null,
							cachedCost: null,
							cacheWriteCost: null,
							outputCost: null,
							searchCost: null,
							totalCost: null,
							currency: null,
							currencyIssue: true,
							currencyTotals: modelCostPresentation.currencyTotals,
						});
						entry.currencyIssue = true;
						totalCurrencyIssue = true;
					} else {
						const modelCostScaled =
							agg.inputCostScaled +
							agg.cachedCostScaled +
							agg.cacheWriteCostScaled +
							agg.outputCostScaled +
							agg.searchCostScaled;
						const modelCurrency = modelCostPresentation.currency;

						entry.models.push({
							model,
							requestType: row.requestType ?? "CHAT_COMPLETION",
							inputTokens,
							cachedInputTokens: cachedTokens,
							cacheWriteTokens,
							outputTokens,
							searchUnits,
							inputCost: modelCostPresentation.inputCost,
							cachedCost: modelCostPresentation.cachedCost,
							cacheWriteCost: modelCostPresentation.cacheWriteCost,
							outputCost: modelCostPresentation.outputCost,
							searchCost: modelCostPresentation.searchCost,
							totalCost: modelCostPresentation.totalCost,
							currency: modelCurrency,
							currencyIssue: false,
							currencyTotals: modelCostPresentation.currencyTotals,
						});

						entry.totalCostScaled += modelCostScaled;
						entry.totalCostHasKnownCost = true;
						const entryCurrencyState = mergeCurrencyState(
							entry.currency,
							modelCurrency,
						);
						entry.currency = entryCurrencyState.currency;
						entry.currencyIssue ||= entryCurrencyState.issue;
						if (entryCurrencyState.issue) totalCurrencyIssue = true;

						totalCostScaled += modelCostScaled;
						totalCostHasKnownCost = true;
						const totalCurrencyState = mergeCurrencyState(
							totalCurrency,
							modelCurrency,
						);
						totalCurrency = totalCurrencyState.currency;
						if (totalCurrencyState.issue) totalCurrencyIssue = true;
					}
				}

				usersMap.set(id, entry);
			}

			const usersData = Array.from(usersMap.values()).map((user) => ({
				id: user.id,
				name: user.name,
				inputTokens: user.inputTokens,
				cachedInputTokens: user.cachedInputTokens,
				cacheWriteTokens: user.cacheWriteTokens,
				outputTokens: user.outputTokens,
				searchUnits: user.searchUnits,
				totalCost:
					user.totalCostHasKnownCost && !user.currencyIssue
						? scaledCostToNumber(user.totalCostScaled)
						: null,
				currency:
					user.totalCostHasKnownCost && !user.currencyIssue
						? user.currency
						: null,
				currencyIssue: user.currencyIssue,
				currencyTotals: presentCurrencyTotals(user.currencyTotals),
				hasMissingCosts: user.totalCostHasMissingCost,
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
					cacheWriteTokens: totalCacheWriteTokens,
					outputTokens: totalOutputTokens,
					searchUnits: totalSearchUnits,
					totalCost:
						totalCostHasKnownCost && !totalCurrencyIssue
							? scaledCostToNumber(totalCostScaled)
							: null,
					currency:
						totalCostHasKnownCost && !totalCurrencyIssue ? totalCurrency : null,
					currencyTotals: presentCurrencyTotals(reportCurrencyTotals),
					hasMissingCosts: totalCostHasMissingCost,
					currencyIssue: totalCurrencyIssue,
				},
				modelUsage: Array.from(modelTotals.values()).sort((a, b) => {
					if (a.requestType !== b.requestType) {
						return a.requestType === "CHAT_COMPLETION" ? -1 : 1;
					}
					const aUsage =
						a.requestType === "RERANK" ? a.searchUnits : a.outputTokens;
					const bUsage =
						b.requestType === "RERANK" ? b.searchUnits : b.outputTokens;
					return bUsage - aUsage;
				}),
				users: usersData,
				cumulativeCosts: {
					currencies: cumulativeCurrencies,
					points: cumulativeCostPoints,
				},
				hourlyTokens,
				hourlyOutputByDay,
				costsUsed,
			};
		}),
	rebuildCache: adminProcedure
		.input(
			z.object({
				from: z
					.string()
					.trim()
					.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
				to: z
					.string()
					.trim()
					.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const start = new Date(`${input.from}:00Z`);
			const end = new Date(`${input.to}:00Z`);
			if (
				!Number.isFinite(start.getTime()) ||
				!Number.isFinite(end.getTime())
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid UTC range",
				});
			}
			if (end <= start) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "The end of the range must be after its start",
				});
			}

			await rebuildRequestStatisticsCache(ctx.db, start, end);
			return {
				from: start.toISOString(),
				to: end.toISOString(),
			};
		}),
});
