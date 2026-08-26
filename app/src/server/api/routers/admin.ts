import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	BillingUnit,
	billingUnitOptions,
	CostStageType,
	canonicalizeCostTokenType,
	costUnitOptions,
	ModelType,
	modelTypeOptions,
	RequestType,
	requestTypeOptions,
} from "~/lib/costs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	type AzureRule,
	buildCostIdentity,
	classifyConflict,
	costIdentity,
	evaluateRules,
	normalizeAzurePrice,
} from "~/server/azurePricing";
import {
	apikeys,
	azurePricingAudits,
	azurePricingConfig,
	azurePricingRules,
	costs,
	models,
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

const rangeInput = z.enum(["24h", "7d", "30d", "all"]);
const modelInput = z.object({
	modelId: z.string().trim().min(1).max(255),
	modelType: z.enum(modelTypeOptions).default(ModelType.ChatCompletion),
});
const costInput = z
	.object({
		id: z.number().int().positive().optional(),
		model: z.string().trim().min(1).max(255),
		price: z.number().int().nonnegative(),
		validFrom: z.string().trim().min(1).max(32).optional(),
		requestType: z.enum(requestTypeOptions).default(RequestType.ChatCompletion),
		billingUnit: z.enum(billingUnitOptions).default(BillingUnit.Tokens),
		tokenType: z.string().trim().max(255).optional().nullable(),
		unitOfMessure: z.enum(costUnitOptions).optional().nullable(),
		currency: z.string().trim().length(3).optional().nullable(),
		stageType: z.nativeEnum(CostStageType).optional().nullable(),
		stageMinTokens: z.number().int().min(0).optional(),
		stageMaxTokens: z.number().int().min(0).optional().nullable(),
	})
	.superRefine((value, ctx) => {
		const isRerank = value.requestType === RequestType.Rerank;
		if (
			value.billingUnit !==
			(isRerank ? BillingUnit.Searches : BillingUnit.Tokens)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["billingUnit"],
				message: "Billing unit does not match request type",
			});
		}
		if (isRerank && value.tokenType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["tokenType"],
				message: "Rerank costs cannot have a token type",
			});
		}
		if (!isRerank && !value.tokenType?.trim()) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["tokenType"],
				message: "Token type is required for token costs",
			});
		}
	});

const azureConfigInput = z.object({
	serviceName: z.string().trim().min(1).max(255).default("Azure OpenAI"),
	armRegionName: z.string().trim().min(1).max(255),
	currencyCode: z
		.string()
		.trim()
		.regex(/^[A-Za-z]{3}$/)
		.transform((value) => value.toUpperCase()),
	productName: z.string().trim().max(255).nullable().optional(),
	armSkuName: z.string().trim().max(255).nullable().optional(),
	meterName: z.string().trim().max(255).nullable().optional(),
});
const azureRuleInput = z
	.object({
		id: z.number().int().positive().optional(),
		name: z.string().trim().min(1).max(255),
		enabled: z.boolean().default(true),
		priority: z.number().int(),
		action: z.enum(["map", "ignore"]),
		conditions: z
			.array(
				z.object({
					field: z.string().trim().min(1).max(255),
					operator: z.enum(["equals", "contains", "regex"]),
					value: z.string().max(2000),
				}),
			)
			.max(32),
		assignments: z
			.object({
				model: z.string().max(255).optional(),
				requestType: z.enum(requestTypeOptions).optional(),
				billingUnit: z.enum(billingUnitOptions).optional(),
				tokenType: z.string().max(64).optional(),
				stageMinTokens: z.union([z.string(), z.number()]).optional(),
				stageMaxTokens: z.union([z.string(), z.number()]).nullable().optional(),
			})
			.default({}),
	})
	.superRefine((value, ctx) => {
		for (const [index, condition] of value.conditions.entries()) {
			if (condition.operator !== "regex") continue;
			try {
				new RegExp(condition.value);
			} catch {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["conditions", index, "value"],
					message: "Invalid regular expression",
				});
			}
		}
	});

async function fetchAzurePrices(config: z.infer<typeof azureConfigInput>) {
	const filters = [
		`serviceName eq '${config.serviceName.replaceAll("'", "''")}'`,
		`armRegionName eq '${config.armRegionName.replaceAll("'", "''")}'`,
		"priceType eq 'Consumption'",
	];
	for (const [field, value] of [
		["productName", config.productName],
		["armSkuName", config.armSkuName],
		["meterName", config.meterName],
	] as const)
		if (value) {
			const escapedValue = value.replaceAll("'", "''");
			filters.push(
				field === "meterName"
					? `contains(meterName, '${escapedValue}')`
					: `${field} eq '${escapedValue}'`,
			);
		}
	let next: string | undefined =
		`https://prices.azure.com/api/retail/prices?${new URLSearchParams({
			$filter: filters.join(" and "),
			currencyCode: config.currencyCode,
		}).toString()}`;
	const pages: unknown[] = [];
	const rows: Record<string, unknown>[] = [];
	while (next) {
		const response = await fetch(next, { signal: AbortSignal.timeout(30_000) });
		if (!response.ok)
			throw new Error(`Azure Retail Prices returned HTTP ${response.status}`);
		const page = (await response.json()) as {
			Items?: Record<string, unknown>[];
			NextPageLink?: string;
		};
		if (!Array.isArray(page.Items))
			throw new Error("Azure response did not contain an Items array");
		pages.push(page);
		rows.push(
			...page.Items.filter(
				(row) =>
					String(row.type ?? "").toLowerCase() === "consumption" &&
					!row.reservationTerm &&
					!/(?:spot|low priority)/i.test(
						`${String(row.skuName ?? "")} ${String(row.armSkuName ?? "")} ${String(row.meterName ?? "")}`,
					),
			),
		);
		next = page.NextPageLink;
	}
	return { pages, rows };
}

function configSnapshot(
	row:
		| typeof azurePricingConfig.$inferSelect
		| z.infer<typeof azureConfigInput>,
) {
	return {
		serviceName: row.serviceName,
		armRegionName: row.armRegionName,
		currencyCode: row.currencyCode.trim().toUpperCase(),
		productName: row.productName ?? null,
		armSkuName: row.armSkuName ?? null,
		meterName: row.meterName ?? null,
		priceType: "Consumption",
	};
}

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
					totalSearchUnits:
						sql<number>`coalesce(sum(${requests.searchUnits}), 0)`.as(
							"totalSearchUnits",
						),
				})
				.from(requests);
			const totalRow = await (requestTimeFilter
				? totalBase.where(requestTimeFilter)
				: totalBase);

			const modelBase = ctx.db
				.select({
					model: requests.model,
					requestType: requests.requestType,
					tokens:
						sql<number>`coalesce(sum(${requests.inputTokenCount} + ${requests.outputTokenCount}), 0)`.as(
							"tokens",
						),
					searchUnits:
						sql<number>`coalesce(sum(${requests.searchUnits}), 0)`.as(
							"searchUnits",
						),
				})
				.from(requests);
			const modelRows = await (requestTimeFilter
				? modelBase.where(requestTimeFilter)
				: modelBase
			).groupBy(requests.model, requests.requestType);

			const requestsJoin = requestTimeFilter
				? and(eq(apikeys.uuid, requests.apiKeyId), requestTimeFilter)
				: eq(apikeys.uuid, requests.apiKeyId);

			const userRows = await ctx.db
				.select({
					id: users.id,
					name: users.name,
					inputTokens:
						sql<number>`greatest(coalesce(sum(${requests.inputTokenCount} - ${requests.cachedInputTokenCount} - ${requests.cacheWriteTokenCount}), 0), 0)`.as(
							"inputTokens",
						),
					cachedTokens:
						sql<number>`coalesce(sum(${requests.cachedInputTokenCount}), 0)`.as(
							"cachedTokens",
						),
					cacheWriteTokens:
						sql<number>`coalesce(sum(${requests.cacheWriteTokenCount}), 0)`.as(
							"cacheWriteTokens",
						),
					outputTokens:
						sql<number>`coalesce(sum(${requests.outputTokenCount}), 0)`.as(
							"outputTokens",
						),
					searchUnits:
						sql<number>`coalesce(sum(${requests.searchUnits}), 0)`.as(
							"searchUnits",
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
			const totalSearchUnits = Number(totalRow[0]?.totalSearchUnits ?? 0);

			return {
				totalTokens,
				totalSearchUnits,
				modelUsage: modelRows
					.map((row) => ({
						model: row.model ?? "Unknown",
						requestType: row.requestType,
						tokens: Number(row.tokens ?? 0),
						searchUnits: Number(row.searchUnits ?? 0),
					}))
					.filter((row) => row.tokens > 0 || row.searchUnits > 0)
					.sort((a, b) => {
						if (a.requestType !== b.requestType) {
							return a.requestType === RequestType.ChatCompletion ? -1 : 1;
						}
						const aUsage =
							a.requestType === RequestType.Rerank ? a.searchUnits : a.tokens;
						const bUsage =
							b.requestType === RequestType.Rerank ? b.searchUnits : b.tokens;
						return bUsage - aUsage;
					}),
				users: userRows.map((row) => ({
					id: row.id,
					name: row.name ?? row.id,
					inputTokens: Number(row.inputTokens ?? 0),
					cachedTokens: Number(row.cachedTokens ?? 0),
					cacheWriteTokens: Number(row.cacheWriteTokens ?? 0),
					outputTokens: Number(row.outputTokens ?? 0),
					searchUnits: Number(row.searchUnits ?? 0),
					/*
					 * Legacy alias removed; searchUnits is canonical.
					rererankSearchUnits: Number(row.rererankSearchUnits ?? 0),
					*/
					lastActivity: row.lastActivity,
				})),
			};
		}),
	listModels: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({ id: models.id, modelType: models.modelType })
			.from(models)
			.orderBy(models.id);
		return rows;
	}),
	addModel: adminProcedure
		.input(modelInput)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.insert(models)
				.values({ id: input.modelId, modelType: input.modelType })
				.onConflictDoNothing();
		}),
	deleteModel: adminProcedure
		.input(modelInput)
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(models).where(eq(models.id, input.modelId));
		}),
	listCosts: adminProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({
				id: costs.id,
				model: costs.model,
				price: costs.price,
				validFrom: costs.validFrom,
				tokenType: costs.tokenType,
				requestType: costs.requestType,
				billingUnit: costs.billingUnit,
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

		return rows.map((row) => {
			const tokenType =
				row.requestType === RequestType.Rerank
					? null
					: canonicalizeCostTokenType(row.tokenType ?? "");
			if (row.requestType !== RequestType.Rerank && !tokenType) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Invalid costs.token_type for row id=${row.id}: raw token_type=${row.tokenType}`,
				});
			}

			return {
				...row,
				tokenType,
				price: Number(row.price ?? 0),
				validFrom: row.validFrom ?? null,
				currency: row.currency ? row.currency.trim() : null,
				stageType:
					row.stageType === CostStageType.ContextLength
						? CostStageType.ContextLength
						: null,
				stageMinTokens: Number(row.stageMinTokens ?? 0),
				stageMaxTokens: row.stageMaxTokens ?? null,
				requestType: row.requestType,
				billingUnit: row.billingUnit,
			};
		});
	}),
	createCost: adminProcedure
		.input(costInput)
		.mutation(async ({ ctx, input }) => {
			const validFrom =
				input.validFrom?.trim() || new Date().toISOString().slice(0, 10);
			const stageType = input.stageType ?? CostStageType.ContextLength;
			const stageMinTokens = input.stageMinTokens ?? 0;
			const stageMaxTokens = input.stageMaxTokens ?? null;

			await ctx.db.insert(costs).values({
				model: input.model,
				price: input.price,
				validFrom,
				requestType: input.requestType,
				billingUnit: input.billingUnit,
				tokenType: input.tokenType ?? null,
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
			const stageType = update.stageType ?? CostStageType.ContextLength;
			const stageMinTokens = update.stageMinTokens ?? 0;
			const stageMaxTokens = update.stageMaxTokens ?? null;

			await ctx.db.insert(costs).values({
				model: update.model,
				price: update.price,
				validFrom,
				requestType: update.requestType,
				billingUnit: update.billingUnit,
				tokenType: update.tokenType ?? null,
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
				update.stageType ?? original.stageType ?? CostStageType.ContextLength;
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
					requestType: update.requestType,
					billingUnit: update.billingUnit,
					tokenType: update.tokenType ?? null,
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
									eq(costs.requestType, original.requestType),
									eq(costs.billingUnit, original.billingUnit),
									original.tokenType == null
										? sql`${costs.tokenType} IS NULL`
										: eq(costs.tokenType, original.tokenType),
									eq(
										costs.stageType,
										original.stageType ?? CostStageType.ContextLength,
									),
									eq(costs.stageMinTokens, original.stageMinTokens ?? 0),
									originalStageMaxTokens === null
										? sql`${costs.stageMaxTokens} IS NULL`
										: eq(costs.stageMaxTokens, originalStageMaxTokens),
								);
					})(),
				);
		}),
	azurePricing: adminProcedure.query(async ({ ctx }) => {
		const [config] = await ctx.db.select().from(azurePricingConfig).limit(1);
		const rules = await ctx.db
			.select()
			.from(azurePricingRules)
			.orderBy(azurePricingRules.priority, azurePricingRules.id);
		return { config: config ? configSnapshot(config) : null, rules };
	}),
	saveAzurePricingConfig: adminProcedure
		.input(azureConfigInput)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.insert(azurePricingConfig)
				.values({
					...input,
					id: 1,
					priceType: "Consumption",
					updatedAt: new Date().toISOString(),
				})
				.onConflictDoUpdate({
					target: azurePricingConfig.id,
					set: {
						...input,
						priceType: "Consumption",
						updatedAt: new Date().toISOString(),
					},
				});
		}),
	createAzurePricingRule: adminProcedure
		.input(azureRuleInput)
		.mutation(async ({ ctx, input }) => {
			const { id: _id, ...rule } = input;
			await ctx.db.insert(azurePricingRules).values(rule);
		}),
	updateAzurePricingRule: adminProcedure
		.input(azureRuleInput)
		.mutation(async ({ ctx, input }) => {
			if (!input.id)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Rule ID is required",
				});
			const { id, ...rule } = input;
			await ctx.db
				.update(azurePricingRules)
				.set({ ...rule, updatedAt: new Date().toISOString() })
				.where(eq(azurePricingRules.id, id));
		}),
	deleteAzurePricingRule: adminProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.delete(azurePricingRules)
				.where(eq(azurePricingRules.id, input.id));
		}),
	importAzurePricingRules: adminProcedure
		.input(
			z.object({
				rules: z.array(azureRuleInput).min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const rules = input.rules.map(({ id: _id, ...rule }) => rule);
			await ctx.db.transaction(async (tx) => {
				await tx.insert(azurePricingRules).values(rules);
			});
			return { count: rules.length };
		}),
	fetchAzurePricing: adminProcedure.mutation(async ({ ctx }) => {
		const [stored] = await ctx.db.select().from(azurePricingConfig).limit(1);
		if (!stored)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Save Azure pricing configuration first",
			});
		const config = configSnapshot(stored);
		try {
			const fetched = await fetchAzurePrices(config);
			const ruleRows = await ctx.db.select().from(azurePricingRules);
			const modelRows = await ctx.db.select({ id: models.id }).from(models);
			const modelIds = new Set(modelRows.map((model) => model.id));
			const existingRows = await ctx.db
				.select({
					model: costs.model,
					requestType: costs.requestType,
					billingUnit: costs.billingUnit,
					tokenType: costs.tokenType,
					unitOfMessure: costs.unitOfMessure,
					currency: costs.currency,
					stageType: costs.stageType,
					stageMinTokens: costs.stageMinTokens,
					stageMaxTokens: costs.stageMaxTokens,
					validFrom: costs.validFrom,
					price: costs.price,
				})
				.from(costs);
			const latestByIdentity = new Map<
				string,
				{ validFrom: string; price: number }
			>();
			for (const row of existingRows) {
				const identity = costIdentity({
					model: row.model,
					requestType: row.requestType,
					billingUnit: row.billingUnit,
					tokenType: row.tokenType?.trim() ?? null,
					unitOfMessure: row.unitOfMessure ?? "",
					currency: row.currency?.trim() ?? "",
					stageType: row.stageType,
					stageMinTokens: row.stageMinTokens,
					stageMaxTokens: row.stageMaxTokens,
				});
				const current = latestByIdentity.get(identity);
				if (!current || row.validFrom > current.validFrom)
					latestByIdentity.set(identity, {
						validFrom: row.validFrom,
						price: row.price,
					});
			}
			const preview = fetched.rows.map((row, index) => {
				const mapping = evaluateRules(row, ruleRows as AzureRule[], modelIds);
				const normalized =
					mapping.status === "mapped"
						? normalizeAzurePrice(row, config.currencyCode)
						: undefined;
				const errors = [...mapping.errors];
				if (normalized && "error" in normalized)
					errors.push(normalized.error ?? "Invalid Azure price");
				let conflict: "insert" | "older" | "unchanged" | "conflict" | undefined;
				let classification:
					| "insert"
					| "older"
					| "unchanged"
					| "conflict"
					| undefined;
				if (
					mapping.status === "mapped" &&
					normalized &&
					!("error" in normalized)
				) {
					const identity = buildCostIdentity(
						mapping.assignments,
						normalized.currency,
					);
					const historyClassification = classifyConflict(
						{ validFrom: normalized.validFrom, price: normalized.price },
						latestByIdentity.get(costIdentity(identity)),
					);
					if (
						historyClassification === "skip" ||
						historyClassification === "replace"
					) {
						conflict = "conflict";
						classification = "conflict";
					} else {
						conflict = historyClassification;
						classification = historyClassification;
					}
					if (conflict === "conflict")
						errors.push("A same-date price conflict requires a decision");
				}
				return {
					index,
					raw: row,
					...mapping,
					status:
						conflict === "conflict"
							? "conflict"
							: errors.length
								? mapping.status === "mapped"
									? "invalid"
									: "unmapped"
								: mapping.status,
					errors,
					normalized,
					conflict,
					classification,
					decision:
						mapping.status === "ignored"
							? ("ignore" as const)
							: ("skip" as const),
				};
			});
			const duplicatePrices = new Map<string, Set<number>>();
			for (const row of preview) {
				if (
					row.status !== "mapped" ||
					!row.normalized ||
					"error" in row.normalized
				)
					continue;
				const key = `${costIdentity(buildCostIdentity(row.assignments ?? {}, row.normalized.currency))}|${row.normalized.validFrom}`;
				const prices = duplicatePrices.get(key) ?? new Set<number>();
				prices.add(row.normalized.price);
				duplicatePrices.set(key, prices);
			}
			for (const row of preview) {
				if (
					row.status !== "mapped" ||
					!row.normalized ||
					"error" in row.normalized
				)
					continue;
				const key = `${costIdentity(buildCostIdentity(row.assignments ?? {}, row.normalized.currency))}|${row.normalized.validFrom}`;
				if ((duplicatePrices.get(key)?.size ?? 0) > 1) {
					row.status = "conflict";
					row.conflict = "conflict";
					row.errors.push(
						"Multiple fetched rows have different prices for this identity and date",
					);
				}
			}
			const [audit] = await ctx.db
				.insert(azurePricingAudits)
				.values({
					operation: "fetch",
					outcome: "success",
					configuration: config,
					rawResponse: fetched.pages,
					counts: {
						fetched: fetched.rows.length,
						mapped: preview.filter((row) => row.status === "mapped").length,
					},
					rows: preview,
				})
				.returning({ id: azurePricingAudits.id });
			return { auditId: audit?.id, config, rows: preview };
		} catch (error) {
			await ctx.db.insert(azurePricingAudits).values({
				operation: "fetch",
				outcome: "failed",
				configuration: config,
				rawResponse: [],
				counts: {},
				rows: [],
				error: error instanceof Error ? error.message : String(error),
			});
			throw new TRPCError({
				code: "BAD_GATEWAY",
				message: error instanceof Error ? error.message : "Azure fetch failed",
			});
		}
	}),
	importAzurePricing: adminProcedure
		.input(
			z.object({
				auditId: z.number().int().positive(),
				rows: z.array(
					z.object({
						index: z.number().int().nonnegative(),
						decision: z.enum(["skip", "replace", "ignore"]).default("skip"),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [fetchedAudit] = await ctx.db
				.select()
				.from(azurePricingAudits)
				.where(eq(azurePricingAudits.id, input.auditId));
			if (
				!fetchedAudit ||
				fetchedAudit.operation !== "fetch" ||
				fetchedAudit.outcome !== "success"
			)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Fetch audit not found",
				});
			const config = azureConfigInput.parse(fetchedAudit.configuration);
			const ruleRows = await ctx.db.select().from(azurePricingRules);
			const modelRows = await ctx.db.select({ id: models.id }).from(models);
			const modelIds = new Set(modelRows.map((model) => model.id));
			const pages = Array.isArray(fetchedAudit.rawResponse)
				? fetchedAudit.rawResponse
				: [];
			const sourceRows = pages.flatMap((page) => {
				if (
					!page ||
					typeof page !== "object" ||
					!Array.isArray((page as { Items?: unknown[] }).Items)
				)
					return [];
				return (page as { Items: Record<string, unknown>[] }).Items.filter(
					(row) =>
						String(row.type ?? "").toLowerCase() === "consumption" &&
						!row.reservationTerm &&
						!/(?:spot|low priority)/i.test(
							`${String(row.skuName ?? "")} ${String(row.armSkuName ?? "")} ${String(row.meterName ?? "")}`,
						),
				);
			});
			const inputIndexes = new Set(input.rows.map((row) => row.index));
			if (
				input.rows.length !== sourceRows.length ||
				inputIndexes.size !== sourceRows.length ||
				[...inputIndexes].some((index) => index >= sourceRows.length)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Every fetched row must have an explicit decision",
				});
			}
			const duplicatePrices = new Map<string, Set<number>>();
			for (const decision of input.rows) {
				if (decision.decision === "ignore") continue;
				const raw = sourceRows[decision.index];
				if (!raw)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Preview row no longer exists",
					});
				const mapping = evaluateRules(raw, ruleRows as AzureRule[], modelIds);
				if (mapping.status !== "mapped")
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Every invalid row must be explicitly ignored",
					});
				const normalized = normalizeAzurePrice(raw, config.currencyCode);
				if ("error" in normalized)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: normalized.error,
					});
				const key = `${costIdentity(buildCostIdentity(mapping.assignments, normalized.currency))}|${normalized.validFrom}`;
				const prices = duplicatePrices.get(key) ?? new Set<number>();
				prices.add(normalized.price);
				duplicatePrices.set(key, prices);
			}
			if ([...duplicatePrices.values()].some((prices) => prices.size > 1))
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Multiple fetched prices share an identity and date; explicitly ignore all but one",
				});
			try {
				const result = await ctx.db.transaction(async (tx) => {
					const accepted = [];
					for (const decision of input.rows) {
						if (decision.decision === "ignore") {
							accepted.push({ index: decision.index, status: "ignored" });
							continue;
						}
						const raw = sourceRows[decision.index];
						if (!raw)
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: "Preview row no longer exists",
							});
						const mapping = evaluateRules(
							raw,
							ruleRows as AzureRule[],
							modelIds,
						);
						if (mapping.status !== "mapped")
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: "Every invalid row must be explicitly ignored",
							});
						const normalized = normalizeAzurePrice(raw, config.currencyCode);
						if ("error" in normalized)
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: normalized.error,
							});
						const assignment = mapping.assignments as {
							model?: string;
							requestType?: string;
							billingUnit?: string;
							tokenType?: string;
							stageMinTokens?: number;
							stageMaxTokens?: number | null;
						};
						const identity = {
							model: assignment.model ?? "",
							requestType: assignment.requestType ?? "",
							billingUnit: assignment.billingUnit ?? "",
							tokenType: assignment.tokenType ?? null,
							unitOfMessure: "1M",
							currency: normalized.currency,
							stageType: "context_length",
							stageMinTokens: assignment.stageMinTokens ?? 0,
							stageMaxTokens: assignment.stageMaxTokens ?? null,
						};
						const history = await tx
							.select({
								id: costs.id,
								validFrom: costs.validFrom,
								price: costs.price,
							})
							.from(costs)
							.where(
								and(
									eq(costs.model, identity.model),
									eq(costs.requestType, identity.requestType as never),
									eq(costs.billingUnit, identity.billingUnit as never),
									identity.tokenType === null
										? sql`${costs.tokenType} IS NULL`
										: eq(costs.tokenType, identity.tokenType),
									eq(costs.unitOfMessure, identity.unitOfMessure as never),
									eq(costs.currency, identity.currency),
									eq(costs.stageType, identity.stageType),
									eq(costs.stageMinTokens, identity.stageMinTokens),
									identity.stageMaxTokens === null
										? sql`${costs.stageMaxTokens} IS NULL`
										: eq(costs.stageMaxTokens, identity.stageMaxTokens),
								),
							)
							.orderBy(sql`${costs.validFrom} desc`)
							.limit(1);
						const classification = classifyConflict(
							{ validFrom: normalized.validFrom, price: normalized.price },
							history[0],
							decision.decision,
						);
						if (
							classification === "older" ||
							classification === "unchanged" ||
							classification === "skip"
						) {
							accepted.push({ index: decision.index, status: classification });
							continue;
						}
						if (classification === "replace" && history[0])
							await tx.delete(costs).where(eq(costs.id, history[0].id));
						const [created] = await tx
							.insert(costs)
							.values({
								...identity,
								requestType: identity.requestType as never,
								billingUnit: identity.billingUnit as never,
								price: normalized.price,
								validFrom: normalized.validFrom,
								unitOfMessure: "1M",
								currency: normalized.currency,
								tokenType: identity.tokenType,
							})
							.returning({ id: costs.id });
						accepted.push({
							index: decision.index,
							status: classification,
							id: created?.id,
						});
					}
					return accepted;
				});
				await ctx.db.insert(azurePricingAudits).values({
					operation: "import",
					outcome: "success",
					fetchedAuditId: fetchedAudit.id,
					configuration: config,
					rawResponse: fetchedAudit.rawResponse,
					counts: { rows: input.rows.length },
					rows: result,
				});
				return result;
			} catch (error) {
				await ctx.db.insert(azurePricingAudits).values({
					operation: "import",
					outcome: "failed",
					fetchedAuditId: fetchedAudit.id,
					configuration: config,
					rawResponse: fetchedAudit.rawResponse,
					counts: {},
					rows: input.rows,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		}),
	listAzurePricingAudits: adminProcedure.query(({ ctx }) =>
		ctx.db
			.select({
				id: azurePricingAudits.id,
				fetchedAuditId: azurePricingAudits.fetchedAuditId,
				createdAt: azurePricingAudits.createdAt,
				operation: azurePricingAudits.operation,
				outcome: azurePricingAudits.outcome,
				counts: azurePricingAudits.counts,
				error: azurePricingAudits.error,
			})
			.from(azurePricingAudits)
			.orderBy(sql`${azurePricingAudits.createdAt} desc`)
			.limit(50),
	),
	getAzurePricingAudit: adminProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const [audit] = await ctx.db
				.select()
				.from(azurePricingAudits)
				.where(eq(azurePricingAudits.id, input.id));
			if (!audit) throw new TRPCError({ code: "NOT_FOUND" });
			return audit;
		}),
});
