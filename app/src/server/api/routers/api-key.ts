import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { hash } from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	addCurrencyTotal,
	addResolvedTotalCost,
	createCurrencyTotals,
	createTotalCostAggregate,
	mergeCurrencyState,
	presentCurrencyTotals,
	presentTotalCost,
	scaledCostToNumber,
} from "~/server/costAggregation";
import {
	buildCostStageIndex,
	type CostStageRow,
	resolveRequestCostStage,
	resolveRerankCost,
} from "~/server/costStageResolver";
import { apikeys, costs, requests, users } from "~/server/db/schema";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
				requestType: requests.requestType,
				inputTokens:
					sql<number>`greatest(coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount} - ${requests.cacheWriteTokenCount}), 0), 0)`.as(
						"inputTokens",
					),
				cachedInputTokens:
					sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
						"cachedInputTokens",
					),
				cacheWriteTokens:
					sql<number>`coalesce(sum(${requests.cacheWriteTokenCount}), 0)`.as(
						"cacheWriteTokens",
					),
				outputTokens:
					sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
						"outputTokens",
					),
				searchUnits: sql<number>`coalesce(sum(${requests.searchUnits}), 0)`.as(
					"searchUnits",
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
				requests.requestType,
			);

		// Fetch and index all pricing rows once; resolve cost per request afterwards.
		const costRows = await ctx.db
			.select({
				model: costs.model,
				price: costs.price,
				validFrom: costs.validFrom,
				requestType: costs.requestType,
				billingUnit: costs.billingUnit,
				tokenType: costs.tokenType,
				unitOfMessure: costs.unitOfMessure,
				currency: costs.currency,
				stageType: costs.stageType,
				stageMinTokens: costs.stageMinTokens,
				stageMaxTokens: costs.stageMaxTokens,
			})
			.from(costs);

		const costStageRows: CostStageRow[] = costRows.map((row) => ({
			model: row.model ?? "",
			requestType: row.requestType,
			billingUnit: row.billingUnit,
			tokenType: row.tokenType ?? "",
			price: Number(row.price ?? 0),
			validFrom: row.validFrom ?? new Date(0),
			unitOfMessure: (row.unitOfMessure ??
				null) as CostStageRow["unitOfMessure"],
			currency: row.currency ? row.currency.trim().toUpperCase() : null,
			stageType: row.stageType ?? "context_length",
			stageMinTokens: Number(row.stageMinTokens ?? 0),
			stageMaxTokens: row.stageMaxTokens ?? null,
		}));

		const costStageIndex = buildCostStageIndex(costStageRows);

		const costAggByKeyModel = new Map<
			string,
			ReturnType<typeof createTotalCostAggregate>
		>();

		const requestRowsForCost = await ctx.db
			.select({
				apiKeyId: apikeys.uuid,
				model: requests.model,
				requestTime: requests.requestTime,
				inputTokenCount: requests.inputTokenCount,
				cachedInputTokenCount: requests.cachedInputTokenCount,
				cacheWriteTokenCount: requests.cacheWriteTokenCount,
				outputTokenCount: requests.outputTokenCount,
				requestType: requests.requestType,
				searchUnits: requests.searchUnits,
			})
			.from(requests)
			.innerJoin(apikeys, eq(apikeys.uuid, requests.apiKeyId))
			.innerJoin(users, eq(apikeys.owner, users.id))
			.where(eq(users.id, userId));

		for (const row of requestRowsForCost) {
			const model = row.model ?? null;
			if (!model) continue;
			if (!row.requestTime) continue;

			const inputTokenCount = Number(row.inputTokenCount ?? 0);
			const cachedInputTokenCount = Number(row.cachedInputTokenCount ?? 0);
			const cacheWriteTokens = Number(row.cacheWriteTokenCount ?? 0);
			const outputTokenCount = Number(row.outputTokenCount ?? 0);
			const searchUnits = Number(row.searchUnits ?? 0);

			if (
				inputTokenCount + outputTokenCount + searchUnits + cacheWriteTokens <=
				0
			)
				continue;

			const resolved =
				row.requestType === "RERANK"
					? (() => {
							const rerank = resolveRerankCost(costStageRows, {
								model,
								requestTime: new Date(row.requestTime),
								searchUnits,
							});
							return {
								totalCost: rerank.cost,
								currency: rerank.currency,
								missing: rerank.missing,
							};
						})()
					: resolveRequestCostStage(costStageIndex, {
							model,
							requestTime: new Date(row.requestTime),
							inputTokenCount,
							cachedInputTokenCount,
							cacheWriteTokenCount: cacheWriteTokens,
							outputTokenCount,
						});

			const aggKey = `${row.apiKeyId}::${model}::${row.requestType}`;
			const agg = costAggByKeyModel.get(aggKey) ?? createTotalCostAggregate();
			addResolvedTotalCost(agg, resolved);

			costAggByKeyModel.set(aggKey, agg);
		}

		type ApiKeyUsageModel = {
			model: string;
			requestType: string;
			inputTokens: number;
			cachedInputTokens: number;
			cacheWriteTokens: number;
			outputTokens: number;
			searchUnits: number;
			cost: number | null;
			currency: string | null;
			currencyTotals: Array<{ currency: string; totalCost: number }>;
		};
		type ApiKeyUsageEntry = {
			id: string;
			description: string | null;
			deactivated: boolean;
			inputTokens: number;
			cachedInputTokens: number;
			cacheWriteTokens: number;
			outputTokens: number;
			searchUnits: number;
			createdAt: string | null;
			models: ApiKeyUsageModel[];
			costScaled: bigint;
			costMissing: boolean;
			currencyIssue: boolean;
			currency: string | null;
			currencyTotals: Map<string, bigint>;
		};
		const byKey = new Map<string, ApiKeyUsageEntry>();

		for (const row of usageRows) {
			const id = row.id;
			const entry: ApiKeyUsageEntry = byKey.get(id) ?? {
				id,
				description: row.description,
				deactivated: row.deactivated,
				inputTokens: 0,
				cachedInputTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 0,
				searchUnits: 0,
				createdAt: row.createdAt ?? null,
				models: [],
				costScaled: 0n,
				costMissing: false,
				currencyIssue: false,
				currency: null,
				currencyTotals: createCurrencyTotals(),
			};

			const inputTokens = Number(row.inputTokens ?? 0);
			const cachedInputTokens = Number(row.cachedInputTokens ?? 0);
			const cacheWriteTokens = Number(row.cacheWriteTokens ?? 0);
			const outputTokens = Number(row.outputTokens ?? 0);
			const searchUnits = Number(row.searchUnits ?? 0);

			entry.inputTokens += inputTokens;
			entry.cachedInputTokens += cachedInputTokens;
			entry.cacheWriteTokens += cacheWriteTokens;
			entry.outputTokens += outputTokens;
			entry.searchUnits += searchUnits;
			if (!entry.createdAt) entry.createdAt = row.createdAt ?? null;

			const model = row.model ?? "Unknown";
			const requestType = row.requestType ?? "CHAT_COMPLETION";
			if (
				inputTokens +
					cachedInputTokens +
					cacheWriteTokens +
					outputTokens +
					searchUnits >
				0
			) {
				const aggKey = `${id}::${model}::${requestType}`;
				const modelCostPresentation = presentTotalCost(
					costAggByKeyModel.get(aggKey),
				);
				for (const currencyTotal of modelCostPresentation.currencyTotals) {
					addCurrencyTotal(
						entry.currencyTotals,
						currencyTotal.currency,
						currencyTotal.totalCost,
					);
				}

				entry.models.push({
					model,
					requestType,
					inputTokens,
					cachedInputTokens,
					cacheWriteTokens,
					outputTokens,
					searchUnits,
					cost: modelCostPresentation.cost,
					currency: modelCostPresentation.currency,
					currencyTotals: modelCostPresentation.currencyTotals,
				});

				const modelAgg = costAggByKeyModel.get(aggKey);
				if (!modelAgg || modelCostPresentation.missing) {
					entry.costMissing = true;
					entry.currency = null;
				} else if (modelCostPresentation.currencyIssue) {
					entry.currencyIssue = true;
					entry.currency = null;
				} else {
					entry.costScaled += modelAgg.totalCostScaled;
					const currencyState = mergeCurrencyState(
						entry.currency,
						modelCostPresentation.currency,
					);
					entry.currency = currencyState.currency;
					entry.currencyIssue ||= currencyState.issue;
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
			cacheWriteTokens: row.cacheWriteTokens,
			outputTokens: row.outputTokens,
			searchUnits: row.searchUnits,
			createdAt: row.createdAt ?? null,
			cost:
				row.costMissing || row.currencyIssue
					? null
					: scaledCostToNumber(row.costScaled),
			currency:
				row.costMissing || row.currencyIssue ? null : (row.currency ?? null),
			currencyIssue: row.currencyIssue,
			currencyTotals: presentCurrencyTotals(row.currencyTotals),
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
				description: input.description?.trim() || null,
			});

			return { token, id };
		}),
});
