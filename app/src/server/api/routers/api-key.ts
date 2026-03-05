import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { hash } from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { apikeys, costs, requests, users } from "~/server/db/schema";

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

		const usageRows = await ctx.db
			.select({
				id: apikeys.uuid,
				description: apikeys.description,
				deactivated: apikeys.deactivated,
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
				createdAt: sql<string | null>`min(${requests.requestTime})`.as(
					"createdAt",
				),
			})
			.from(apikeys)
			.innerJoin(users, eq(apikeys.owner, users.id))
			.leftJoin(requests, eq(apikeys.uuid, requests.apiKeyId))
			.where(eq(users.id, userId))
			.groupBy(
				apikeys.uuid,
				apikeys.description,
				apikeys.deactivated,
				requests.model,
			);

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

		const normalize = (value: string | null | undefined) =>
			(value ?? "").trim().toLowerCase();

		const costIndex = new Map<
			string,
			Map<
				string,
				{
					price: number;
					validFrom: string | null;
					unit: "1M" | "1K" | null;
					currency: string | null;
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
				});
			}
			costIndex.set(modelKey, modelMap);
		}

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

		const calcTokenCost = (
			model: string,
			tokens: number,
			aliases: string[],
		) => {
			if (tokens <= 0) return { cost: 0, missing: false };
			const modelKey = normalize(model);
			const modelMap = costIndex.get(modelKey);
			if (!modelMap) return { cost: 0, missing: true };
			let entry:
				| {
						price: number;
						validFrom: string | null;
						unit: "1M" | "1K" | null;
						currency: string | null;
				  }
				| undefined;
			for (const alias of aliases) {
				entry = modelMap.get(alias);
				if (entry) break;
			}
			if (!entry) return { cost: 0, missing: true };
			return {
				cost: (tokens / unitDivisor(entry.unit)) * priceToCurrency(entry.price),
				missing: false,
				currency: entry.currency,
			};
		};

		const byKey = new Map<
			string,
			{
				id: string;
				description: string | null;
				deactivated: boolean;
				inputTokens: number;
				cachedInputTokens: number;
				outputTokens: number;
				createdAt: string | null;
				models: Array<{
					model: string;
					inputTokens: number;
					cachedInputTokens: number;
					outputTokens: number;
					cost: number | null;
					currency: string | null;
				}>;
				cost: number | null;
				currency: string | null;
			}
		>();

		for (const row of usageRows) {
			const id = row.id;
			const entry = byKey.get(id) ?? {
				id,
				description: row.description,
				deactivated: row.deactivated,
				inputTokens: 0,
				cachedInputTokens: 0,
				outputTokens: 0,
				createdAt: row.createdAt ?? null,
				models: [],
				cost: 0,
				currency: null,
			};

			const inputTokens = Number(row.inputTokens ?? 0);
			const cachedInputTokens = Number(row.cachedInputTokens ?? 0);
			const outputTokens = Number(row.outputTokens ?? 0);

			entry.inputTokens += inputTokens;
			entry.cachedInputTokens += cachedInputTokens;
			entry.outputTokens += outputTokens;
			if (!entry.createdAt) entry.createdAt = row.createdAt ?? null;

			const model = row.model ?? "Unknown";
			if (inputTokens + cachedInputTokens + outputTokens > 0) {
				const inputCost = calcTokenCost(model, inputTokens, tokenAliases.input);
				const cachedCost = calcTokenCost(
					model,
					cachedInputTokens,
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
					cachedInputTokens,
					outputTokens,
					cost: modelCost,
					currency: modelCost === null ? null : modelCurrency,
				});

				if (entry.cost !== null) {
					entry.cost = modelCost === null ? null : entry.cost + modelCost;
					if (entry.cost === null) {
						entry.currency = null;
					} else if (entry.currency === null) {
						entry.currency = modelCurrency;
					} else if (modelCurrency && entry.currency !== modelCurrency) {
						entry.currency = null;
					}
				}
			}

			byKey.set(id, entry);
		}

		return Array.from(byKey.values()).map((row) => ({
			id: row.id,
			description: row.description,
			deactivated: row.deactivated,
			inputTokens: row.inputTokens,
			cachedInputTokens: row.cachedInputTokens,
			outputTokens: row.outputTokens,
			createdAt: row.createdAt ?? null,
			cost: row.cost,
			currency: row.currency ?? null,
			models: row.models.sort((a, b) => a.model.localeCompare(b.model)),
		}));
	}),
	deactivateApiKey: protectedProcedure
		.input(
			z.object({
				id: z.string().trim().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owner = ctx.session.user.id;
			if (!owner) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			await ctx.db
				.update(apikeys)
				.set({ deactivated: true })
				.where(and(eq(apikeys.uuid, input.id), eq(apikeys.owner, owner)));
		}),
	createApiKey: protectedProcedure
		.input(
			z.object({
				description: z.string().trim().max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owner = ctx.session.user.id;
			if (!owner) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const token = base32Encode(randomBytes(32)).slice(0, 32);
			const hashed = await hash(token, 5);
			const id = randomUUID();

			await ctx.db.insert(users).values({ id: owner }).onConflictDoNothing();

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
