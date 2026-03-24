import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { costUnitOptions } from "~/lib/costs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { apikeys, costs, models, requests, users } from "~/server/db/schema";

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
const costInput = z.object({
	id: z.number().int().positive().optional(),
	model: z.string().trim().min(1).max(255),
	price: z.number().int().nonnegative(),
	validFrom: z.string().trim().min(1).max(32).optional(),
	tokenType: z.string().trim().min(1).max(255),
	unitOfMessure: z.enum(costUnitOptions).optional().nullable(),
	currency: z.string().trim().length(3).optional().nullable(),
	stageType: z.string().trim().min(1).max(255).optional().nullable(),
	stageMinTokens: z.number().int().min(0).optional(),
	stageMaxTokens: z.number().int().min(0).optional().nullable(),
});

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
								}[input.range],
						).toISOString();

			const requestTimeFilter = since
				? sql`${requests.requestTime} >= ${since}`
				: undefined;

			const totalBase = ctx.db
				.select({
					totalTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"totalTokens",
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
							"tokens",
						),
				})
				.from(requests);
			const modelRows = await (requestTimeFilter
				? modelBase.where(requestTimeFilter)
				: modelBase
			).groupBy(requests.model);

			const requestsJoin = requestTimeFilter
				? and(eq(apikeys.uuid, requests.apiKeyId), requestTimeFilter)
				: eq(apikeys.uuid, requests.apiKeyId);

			const userRows = await ctx.db
				.select({
					id: users.id,
					name: users.name,
					inputTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount}), 0)`.as(
							"inputTokens",
						),
					cachedTokens:
						sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
							"cachedTokens",
						),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens",
						),
					lastActivity: sql<string | null>`max(${requests.requestTime})`.as(
						"lastActivity",
					),
					totalTokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"totalTokens",
						),
				})
				.from(users)
				.leftJoin(apikeys, eq(apikeys.owner, users.id))
				.leftJoin(requests, requestsJoin)
				.groupBy(users.id, users.name)
				.orderBy(
					sql`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0) desc`,
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
	listModels: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({ id: models.id })
			.from(models)
			.orderBy(models.id);
		return rows.map((row) => row.id);
	}),
	listCosts: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({
				id: costs.id,
				model: costs.model,
				price: costs.price,
				validFrom: costs.validFrom,
				tokenType: costs.tokenType,
				unitOfMessure: costs.unitOfMessure,
				currency: costs.currency,
				stageType: costs.stageType,
				stageMinTokens: costs.stageMinTokens,
				stageMaxTokens: costs.stageMaxTokens,
			})
			.from(costs)
			.orderBy(
				costs.model,
				costs.tokenType,
				costs.validFrom,
				costs.stageMinTokens,
			);

		return rows.map((row) => ({
			...row,
			price: Number(row.price ?? 0),
			validFrom: row.validFrom ?? null,
			currency: row.currency ? row.currency.trim() : null,
			stageType: row.stageType ? row.stageType.trim() : null,
			stageMinTokens: Number(row.stageMinTokens ?? 0),
			stageMaxTokens: row.stageMaxTokens ?? null,
		}));
	}),
	createCost: adminProcedure
		.input(costInput)
		.mutation(async ({ ctx, input }) => {
			const validFrom =
				input.validFrom?.trim() || new Date().toISOString().slice(0, 10);
			const stageType = input.stageType?.trim() || "context_length";
			const stageMinTokens = input.stageMinTokens ?? 0;
			const stageMaxTokens = input.stageMaxTokens ?? null;

			await ctx.db.insert(costs).values({
				model: input.model,
				price: input.price,
				validFrom,
				tokenType: input.tokenType,
				unitOfMessure: input.unitOfMessure ?? null,
				currency: input.currency ?? null,
				stageType,
				stageMinTokens,
				stageMaxTokens,
			});
		}),
	updatePricing: adminProcedure
		.input(
			z.object({
				update: costInput,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const validFrom = new Date().toISOString().slice(0, 10);
			const update = input.update;
			const stageType = update.stageType?.trim() || "context_length";
			const stageMinTokens = update.stageMinTokens ?? 0;
			const stageMaxTokens = update.stageMaxTokens ?? null;

			await ctx.db.insert(costs).values({
				model: update.model,
				price: update.price,
				validFrom,
				tokenType: update.tokenType,
				unitOfMessure: update.unitOfMessure ?? null,
				currency: update.currency ?? null,
				stageType,
				stageMinTokens,
				stageMaxTokens,
			});
		}),
	updateCost: adminProcedure
		.input(
			z.object({
				original: costInput,
				update: costInput,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const original = input.original;
			const update = input.update;
			const validFrom = update.validFrom?.trim() || original.validFrom?.trim();

			if (!validFrom || !original.validFrom) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			const stageType =
				update.stageType?.trim() ||
				original.stageType?.trim() ||
				"context_length";
			const stageMinTokens =
				update.stageMinTokens ?? original.stageMinTokens ?? 0;
			const stageMaxTokens =
				update.stageMaxTokens ?? original.stageMaxTokens ?? null;

			await ctx.db
				.update(costs)
				.set({
					model: update.model,
					price: update.price,
					validFrom,
					tokenType: update.tokenType,
					unitOfMessure: update.unitOfMessure ?? null,
					currency: update.currency ?? null,
					stageType,
					stageMinTokens,
					stageMaxTokens,
				})
				.where(
					// Drizzle typed columns don't narrow correctly through complex inline expressions,
					// so keep this as a local variable to get proper TypeScript null handling.
					(() => {
						const originalStageMaxTokens = original.stageMaxTokens ?? null;

						return original.id
							? eq(costs.id, original.id)
							: and(
									eq(costs.model, original.model),
									eq(costs.price, original.price),
									eq(costs.validFrom, original.validFrom),
									eq(costs.tokenType, original.tokenType),
									eq(
										costs.stageType,
										original.stageType?.trim() || "context_length",
									),
									eq(costs.stageMinTokens, original.stageMinTokens ?? 0),
									originalStageMaxTokens === null
										? sql`${costs.stageMaxTokens} IS NULL`
										: eq(costs.stageMaxTokens, originalStageMaxTokens),
								);
					})(),
				);
		}),
});
