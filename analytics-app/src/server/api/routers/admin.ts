import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { apikeys, requests, users } from "~/server/db/schema";

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

const rangeInput = z.enum(["24h", "7d", "30d", "all"]);

export const adminRouter = createTRPCRouter({
	getUsageStats: adminProcedure
		.input(z.object({ range: rangeInput }))
		.query(async ({ ctx, input }) => {
			const now = Date.now();
			const since =
				input.range === "all"
					? null
					: new Date(
							now -
								{
									"24h": 24 * 60 * 60 * 1000,
									"7d": 7 * 24 * 60 * 60 * 1000,
									"30d": 30 * 24 * 60 * 60 * 1000,
									all: 0,
								}[input.range]
						).toISOString();

			const requestTimeFilter = since
				? sql`${requests.requestTime} >= ${since}`
				: undefined;

			const totalBase = ctx.db
				.select({
					totalTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"totalTokens"
						),
				})
				.from(requests);
			const totalRow = await (requestTimeFilter
				? totalBase.where(requestTimeFilter)
				: totalBase);

			const modelBase = ctx.db
				.select({
					model: requests.model,
					tokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"tokens"
						),
				})
				.from(requests);
			const modelRows = await (requestTimeFilter
				? modelBase.where(requestTimeFilter)
				: modelBase)
				.groupBy(requests.model);

			const requestsJoin = requestTimeFilter
				? and(eq(apikeys.uuid, requests.apiKeyId), requestTimeFilter)
				: eq(apikeys.uuid, requests.apiKeyId);

			const userRows = await ctx.db
				.select({
					id: users.id,
					name: users.name,
					inputTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount}), 0)`.as(
							"inputTokens"
						),
					cachedTokens:
						sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
							"cachedTokens"
						),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens"
						),
					lastActivity: sql<string | null>`max(${requests.requestTime})`.as(
						"lastActivity"
					),
					totalTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"totalTokens"
						),
				})
				.from(users)
				.leftJoin(apikeys, eq(apikeys.owner, users.id))
				.leftJoin(requests, requestsJoin)
				.groupBy(users.id, users.name)
				.orderBy(
					sql`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0) desc`
				);

			const totalTokens = Number(totalRow[0]?.totalTokens ?? 0);

			return {
				totalTokens,
				modelUsage: modelRows
					.map((row) => ({
						model: row.model ?? "Unknown",
						tokens: Number(row.tokens ?? 0),
					}))
					.filter((row) => row.tokens > 0)
					.sort((a, b) => b.tokens - a.tokens),
				users: userRows.map((row) => ({
					id: row.id,
					name: row.name ?? row.id,
					inputTokens: Number(row.inputTokens ?? 0),
					cachedTokens: Number(row.cachedTokens ?? 0),
					outputTokens: Number(row.outputTokens ?? 0),
					lastActivity: row.lastActivity,
				})),
			};
		}),
});
