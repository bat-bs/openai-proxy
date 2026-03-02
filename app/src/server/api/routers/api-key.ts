import { randomBytes, randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { apikeys, requests, users } from "~/server/db/schema";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_AIAPI = "openai";

function base32Encode(bytes: Uint8Array) {
	let output = "";
	let value = 0;
	let bits = 0;

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0) {
		output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	}

	while (output.length % 8 !== 0) {
		output += "=";
	}

	return output;
}

export const apiKeyRouter = createTRPCRouter({
	getApiKeys: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) return [];

		const rows = await ctx.db
			.select({
				id: apikeys.uuid,
				description: apikeys.description,
				inputTokens:
					sql<number>`coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount}), 0)`.as(
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
			.where(eq(users.id, userId))
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
	createApiKey: protectedProcedure
		.input(
			z.object({
				description: z.string().trim().max(255).optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			const owner = ctx.session.user.id;
			if (!owner) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const token = base32Encode(randomBytes(32)).slice(0, 32);
			const hashed = await hash(token, 5);
			const id = randomUUID();

			await ctx.db
				.insert(users)
				.values({ id: owner })
				.onConflictDoNothing();

			await ctx.db.insert(apikeys).values({
				uuid: id,
				apikey: hashed,
				owner,
				aiapi: DEFAULT_AIAPI,
				description: input.description?.trim() || null,
			});

			return { token, id };
		}),
});
