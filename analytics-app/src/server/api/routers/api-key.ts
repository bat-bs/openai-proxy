import { eq, sql } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { apikeys, requests, users } from "~/server/db/schema";

export const apiKeyRouter = createTRPCRouter({
	getApiKeys: protectedProcedure.query(async ({ ctx }) => {
		const userName = ctx.session.user.name;
		if (!userName) return [];

		const rows = await ctx.db
			.select({
				id: apikeys.uuid,
				description: apikeys.description,
				inputTokens: sql<number>`coalesce(sum(${requests.inputTokenCount}), 0)`.as(
					"inputTokens"
				),
				cachedInputTokens: sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
					"cachedInputTokens"
				),
				outputTokens: sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
					"outputTokens"
				),
				createdAt: sql<string | null>`min(${requests.requestTime})`.as("createdAt"),
			})
			.from(apikeys)
			.innerJoin(users, eq(apikeys.owner, users.id))
			.leftJoin(requests, eq(apikeys.uuid, requests.apiKeyId))
			.where(eq(users.name, userName))
			.groupBy(apikeys.uuid, apikeys.description);

		return rows.map((row) => ({
			id: row.id,
			description: row.description,
			inputTokens: Number(row.inputTokens ?? 0),
			cachedInputTokens: Number(row.cachedInputTokens ?? 0),
			outputTokens: Number(row.outputTokens ?? 0),
			createdAt: row.createdAt ?? null,
		}));
	}),
});
