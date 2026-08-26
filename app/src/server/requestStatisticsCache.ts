import { and, gte, inArray, lt, sql } from "drizzle-orm";

import {
	addBreakdownCostAggregate,
	addResolvedBreakdownCost,
	addResolvedTotalCost,
	addTotalCostAggregate,
	createBreakdownCostAggregate,
	createTotalCostAggregate,
} from "~/server/costAggregation";
import {
	buildCostStageIndex,
	type CostStageRow,
	resolveRequestCostStage,
	resolveRerankCost,
} from "~/server/costStageResolver";
import type { db } from "~/server/db";
import {
	costs,
	requestStatisticsCache,
	requestStatisticsCacheBuckets,
	requests,
} from "~/server/db/schema";

const HOUR_MS = 60 * 60 * 1000;

type AppDatabase = typeof db;
type RequestType = (typeof requests.requestType.enumValues)[number];

export type CachedCostDetail = {
	model: string;
	tokenType: string;
	billingUnit: "TOKENS" | "SEARCHES";
	price: number;
	unit: "1M" | "1K" | null;
	currency: string | null;
	validFrom: string | null;
};

export type RequestStatisticsCacheRow = {
	bucketStart: string;
	apiKeyId: string;
	model: string | null;
	requestType: RequestType;
	requestCount: bigint;
	inputTokenCount: bigint;
	cachedInputTokenCount: bigint;
	cacheWriteTokenCount: bigint;
	outputTokenCount: bigint;
	searchUnits: bigint;
	totalCostScaled: bigint;
	inputCostScaled: bigint;
	cachedCostScaled: bigint;
	cacheWriteCostScaled: bigint;
	outputCostScaled: bigint;
	searchCostScaled: bigint;
	currency: string | null;
	currencyTotals: Record<string, string>;
	missingCost: boolean;
	currencyIssue: boolean;
	usedCosts: unknown[];
};

type CostAggregate = ReturnType<typeof createTotalCostAggregate>;
type BreakdownAggregate = ReturnType<typeof createBreakdownCostAggregate>;

type BucketAggregate = {
	apiKeyId: string;
	model: string;
	requestType: RequestType;
	requestCount: bigint;
	inputTokenCount: bigint;
	cachedInputTokenCount: bigint;
	cacheWriteTokenCount: bigint;
	outputTokenCount: bigint;
	searchUnits: bigint;
	total: CostAggregate;
	breakdown: BreakdownAggregate;
	usedCosts: Map<string, CachedCostDetail>;
};

function floorUtcHour(value: Date) {
	return new Date(
		Date.UTC(
			value.getUTCFullYear(),
			value.getUTCMonth(),
			value.getUTCDate(),
			value.getUTCHours(),
			0,
			0,
			0,
		),
	);
}

function listBuckets(start: Date, end: Date) {
	const buckets: Date[] = [];
	for (
		let cursor = floorUtcHour(start);
		cursor < end;
		cursor = new Date(cursor.getTime() + HOUR_MS)
	) {
		buckets.push(new Date(cursor));
	}
	return buckets;
}

function mergeRanges(buckets: Date[]) {
	const ranges: Array<{ start: Date; end: Date }> = [];
	for (const bucket of buckets) {
		const previous = ranges[ranges.length - 1];
		if (previous && previous.end.getTime() === bucket.getTime()) {
			previous.end = new Date(bucket.getTime() + HOUR_MS);
		} else {
			ranges.push({
				start: new Date(bucket),
				end: new Date(bucket.getTime() + HOUR_MS),
			});
		}
	}
	return ranges;
}

function cacheKey(
	apiKeyId: string,
	model: string | null,
	requestType: RequestType,
) {
	return `${apiKeyId}\u0000${model ?? ""}\u0000${requestType}`;
}

function emptyAggregate(
	apiKeyId: string,
	model: string | null,
	requestType: RequestType,
): BucketAggregate {
	return {
		apiKeyId,
		model: model ?? "",
		requestType,
		requestCount: 0n,
		inputTokenCount: 0n,
		cachedInputTokenCount: 0n,
		cacheWriteTokenCount: 0n,
		outputTokenCount: 0n,
		searchUnits: 0n,
		total: createTotalCostAggregate(),
		breakdown: createBreakdownCostAggregate(),
		usedCosts: new Map(),
	};
}

function costDetail(
	usedCost: CostStageRow,
	tokenType: string,
	stageLabel?: string,
): CachedCostDetail {
	const validFrom = usedCost.validFrom
		? new Date(usedCost.validFrom).toISOString().slice(0, 10)
		: null;
	return {
		model: usedCost.model,
		tokenType: stageLabel ?? tokenType,
		billingUnit: usedCost.billingUnit === "SEARCHES" ? "SEARCHES" : "TOKENS",
		price: usedCost.price,
		unit: (usedCost.unitOfMessure ?? null) as "1M" | "1K" | null,
		currency: usedCost.currency ? usedCost.currency.trim().toUpperCase() : null,
		validFrom,
	};
}

function addUsedCost(
	usedCosts: Map<string, CachedCostDetail>,
	detail: CachedCostDetail,
) {
	const key = [
		detail.model.toLowerCase(),
		detail.tokenType,
		detail.billingUnit,
		detail.price,
		detail.unit ?? "",
		detail.currency ?? "",
		detail.validFrom ?? "",
	].join("\u0000");
	usedCosts.set(key, detail);
}

function addResolvedCosts(
	aggregate: BucketAggregate,
	resolved:
		| ReturnType<typeof resolveRequestCostStage>
		| ReturnType<typeof resolveRerankCost>,
) {
	if ("inputCost" in resolved) {
		addResolvedTotalCost(aggregate.total, resolved);
		if (resolved.missing) return;
		addResolvedBreakdownCost(aggregate.breakdown, resolved);
		if (resolved.inputCost.usedCost) {
			addUsedCost(
				aggregate.usedCosts,
				costDetail(
					resolved.inputCost.usedCost,
					"input",
					`input (${resolved.inputCost.usedCost.stageMinTokens}..${resolved.inputCost.usedCost.stageMaxTokens === null ? "∞" : resolved.inputCost.usedCost.stageMaxTokens})`,
				),
			);
		}
		if (resolved.cachedCost.usedCost) {
			addUsedCost(
				aggregate.usedCosts,
				costDetail(
					resolved.cachedCost.usedCost,
					"cached",
					`cached (${resolved.cachedCost.usedCost.stageMinTokens}..${resolved.cachedCost.usedCost.stageMaxTokens === null ? "∞" : resolved.cachedCost.usedCost.stageMaxTokens})`,
				),
			);
		}
		if (resolved.cacheWriteCost.usedCost) {
			addUsedCost(
				aggregate.usedCosts,
				costDetail(
					resolved.cacheWriteCost.usedCost,
					"cache_write",
					`cache_write (${resolved.cacheWriteCost.usedCost.stageMinTokens}..${resolved.cacheWriteCost.usedCost.stageMaxTokens === null ? "∞" : resolved.cacheWriteCost.usedCost.stageMaxTokens})`,
				),
			);
		}
		if (resolved.outputCost.usedCost) {
			addUsedCost(
				aggregate.usedCosts,
				costDetail(
					resolved.outputCost.usedCost,
					"output",
					`output (${resolved.outputCost.usedCost.stageMinTokens}..${resolved.outputCost.usedCost.stageMaxTokens === null ? "∞" : resolved.outputCost.usedCost.stageMaxTokens})`,
				),
			);
		}
		return;
	}

	addResolvedTotalCost(aggregate.total, {
		totalCost: resolved.cost,
		currency: resolved.currency,
		missing: resolved.missing,
	});
	if (resolved.missing) return;

	if (resolved.usedCost) {
		addResolvedBreakdownCost(aggregate.breakdown, {
			missing: false,
			currency: resolved.currency,
			inputCost: { cost: 0 },
			cachedCost: { cost: 0 },
			cacheWriteCost: { cost: 0 },
			outputCost: { cost: 0 },
			searchCost: { cost: resolved.cost },
		});
		addUsedCost(aggregate.usedCosts, costDetail(resolved.usedCost, "searches"));
	}
}

function serializeCurrencyTotals(currencyTotals: Map<string, bigint>) {
	return Object.fromEntries(
		Array.from(currencyTotals.entries()).map(([currency, value]) => [
			currency,
			value.toString(),
		]),
	);
}

function deserializeCurrencyTotals(value: unknown) {
	const result = new Map<string, bigint>();
	if (!value || typeof value !== "object" || Array.isArray(value))
		return result;
	for (const [currency, amount] of Object.entries(value)) {
		try {
			result.set(currency, BigInt(String(amount)));
		} catch {
			// Ignore malformed cache data; the bucket will be rebuilt if needed.
		}
	}
	return result;
}

function toCostAggregate(row: RequestStatisticsCacheRow): CostAggregate {
	return {
		missing: row.missingCost,
		currency: row.currency,
		totalCostScaled: row.totalCostScaled,
		currencyTotals: deserializeCurrencyTotals(row.currencyTotals),
		currencyIssue: row.currencyIssue,
	};
}

function toBreakdownAggregate(
	row: RequestStatisticsCacheRow,
): BreakdownAggregate {
	return {
		missing: row.missingCost,
		currency: row.currency,
		inputCostScaled: row.inputCostScaled,
		cachedCostScaled: row.cachedCostScaled,
		cacheWriteCostScaled: row.cacheWriteCostScaled,
		outputCostScaled: row.outputCostScaled,
		searchCostScaled: row.searchCostScaled,
		currencyTotals: deserializeCurrencyTotals(row.currencyTotals),
		currencyIssue: row.currencyIssue,
	};
}

async function loadCostRows(database: AppDatabase) {
	const rows = await database
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

	return rows.map((row) => ({
		model: row.model,
		price: Number(row.price ?? 0),
		validFrom: row.validFrom ?? new Date(0),
		requestType: row.requestType,
		billingUnit: row.billingUnit,
		tokenType: row.tokenType ?? "",
		unitOfMessure: (row.unitOfMessure ?? null) as CostStageRow["unitOfMessure"],
		currency: row.currency ? row.currency.trim().toUpperCase() : null,
		stageType: row.stageType ?? "context_length",
		stageMinTokens: Number(row.stageMinTokens ?? 0),
		stageMaxTokens: row.stageMaxTokens ?? null,
	})) satisfies CostStageRow[];
}

function buildBucketValues(
	bucketStart: Date,
	rows: Array<{
		apiKeyId: string;
		model: string | null;
		requestType: RequestType;
		requestTime: string | null;
		inputTokenCount: number | null;
		cachedInputTokenCount: number | null;
		cacheWriteTokenCount: number | null;
		outputTokenCount: number | null;
		searchUnits: number | null;
	}>,
	costStageRows: CostStageRow[],
	costStageIndex: Map<string, CostStageRow[]>,
) {
	const aggregates = new Map<string, BucketAggregate>();

	for (const row of rows) {
		const aggregateKey = cacheKey(row.apiKeyId, row.model, row.requestType);
		const aggregate =
			aggregates.get(aggregateKey) ??
			emptyAggregate(row.apiKeyId, row.model, row.requestType);
		aggregate.requestCount += 1n;
		aggregate.inputTokenCount += BigInt(row.inputTokenCount ?? 0);
		aggregate.cachedInputTokenCount += BigInt(row.cachedInputTokenCount ?? 0);
		aggregate.cacheWriteTokenCount += BigInt(row.cacheWriteTokenCount ?? 0);
		aggregate.outputTokenCount += BigInt(row.outputTokenCount ?? 0);
		aggregate.searchUnits += BigInt(row.searchUnits ?? 0);

		const inputTokenCount = Number(row.inputTokenCount ?? 0);
		const cachedInputTokenCount = Number(row.cachedInputTokenCount ?? 0);
		const cacheWriteTokenCount = Number(row.cacheWriteTokenCount ?? 0);
		const outputTokenCount = Number(row.outputTokenCount ?? 0);
		const searchUnits = Number(row.searchUnits ?? 0);
		if (
			row.model &&
			inputTokenCount +
				cachedInputTokenCount +
				cacheWriteTokenCount +
				outputTokenCount +
				searchUnits >
				0
		) {
			const requestTime = new Date(row.requestTime ?? bucketStart);
			const resolved =
				row.requestType === "RERANK"
					? resolveRerankCost(costStageRows, {
							model: row.model,
							requestTime,
							searchUnits,
						})
					: resolveRequestCostStage(costStageIndex, {
							model: row.model,
							requestTime,
							inputTokenCount,
							cachedInputTokenCount,
							cacheWriteTokenCount,
							outputTokenCount,
						});
			addResolvedCosts(aggregate, resolved);
		}
		aggregates.set(aggregateKey, aggregate);
	}

	const values = Array.from(aggregates.values()).map((aggregate) => ({
		bucketStart: bucketStart.toISOString(),
		apiKeyId: aggregate.apiKeyId,
		model: aggregate.model,
		requestType: aggregate.requestType,
		requestCount: aggregate.requestCount,
		inputTokenCount: aggregate.inputTokenCount,
		cachedInputTokenCount: aggregate.cachedInputTokenCount,
		cacheWriteTokenCount: aggregate.cacheWriteTokenCount,
		outputTokenCount: aggregate.outputTokenCount,
		searchUnits: aggregate.searchUnits,
		totalCostScaled: aggregate.total.totalCostScaled,
		inputCostScaled: aggregate.breakdown.inputCostScaled,
		cachedCostScaled: aggregate.breakdown.cachedCostScaled,
		cacheWriteCostScaled: aggregate.breakdown.cacheWriteCostScaled,
		outputCostScaled: aggregate.breakdown.outputCostScaled,
		searchCostScaled: aggregate.breakdown.searchCostScaled,
		currency: aggregate.total.currency,
		currencyTotals: serializeCurrencyTotals(aggregate.total.currencyTotals),
		missingCost: aggregate.total.missing,
		currencyIssue: aggregate.total.currencyIssue,
		usedCosts: Array.from(aggregate.usedCosts.values()),
	}));
	return { bucketStart: bucketStart.toISOString(), values };
}

type PreparedBucket = ReturnType<typeof buildBucketValues>;

function chunks<T>(values: T[], size: number) {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

async function persistBuckets(
	database: AppDatabase,
	buckets: PreparedBucket[],
) {
	if (!buckets.length) return;
	await database.transaction(async (tx) => {
		const bucketStarts = buckets.map((bucket) => bucket.bucketStart);
		// The aggregate rows reference the bucket marker, so create the markers
		// before inserting the rows. The whole operation remains atomic.
		for (const markerChunk of chunks(
			bucketStarts.map((bucketStart) => ({
				bucketStart,
				invalidatedAt: null,
			})),
			250,
		)) {
			await tx
				.insert(requestStatisticsCacheBuckets)
				.values(markerChunk)
				.onConflictDoUpdate({
					target: requestStatisticsCacheBuckets.bucketStart,
					set: { builtAt: sql`now()`, invalidatedAt: null },
				});
		}

		for (const bucketStartChunk of chunks(bucketStarts, 250)) {
			await tx
				.delete(requestStatisticsCache)
				.where(inArray(requestStatisticsCache.bucketStart, bucketStartChunk));
		}

		const values = buckets.flatMap((bucket) => bucket.values);
		for (const valueChunk of chunks(values, 250)) {
			await tx.insert(requestStatisticsCache).values(valueChunk);
		}
	});
}

async function populate(
	database: AppDatabase,
	start: Date,
	end: Date,
	force: boolean,
) {
	const buckets = listBuckets(start, end);
	if (!buckets.length) return;

	const markers = await database
		.select({
			bucketStart: requestStatisticsCacheBuckets.bucketStart,
			invalidatedAt: requestStatisticsCacheBuckets.invalidatedAt,
		})
		.from(requestStatisticsCacheBuckets)
		.where(
			and(
				gte(
					requestStatisticsCacheBuckets.bucketStart,
					buckets[0]?.toISOString() ?? start.toISOString(),
				),
				lt(
					requestStatisticsCacheBuckets.bucketStart,
					new Date(
						(buckets[buckets.length - 1]?.getTime() ?? end.getTime()) + HOUR_MS,
					).toISOString(),
				),
			),
		);
	const validBuckets = new Set(
		markers
			.filter((marker) => marker.invalidatedAt === null)
			.map((marker) => new Date(marker.bucketStart).getTime()),
	);
	const missingBuckets = force
		? buckets
		: buckets.filter((bucket) => !validBuckets.has(bucket.getTime()));
	if (!missingBuckets.length) return;

	const costStageRows = await loadCostRows(database);
	const costStageIndex = buildCostStageIndex(costStageRows);
	const preparedBuckets: PreparedBucket[] = [];
	for (const range of mergeRanges(missingBuckets)) {
		const rows = await database
			.select({
				apiKeyId: requests.apiKeyId,
				model: requests.model,
				requestType: requests.requestType,
				requestTime: requests.requestTime,
				inputTokenCount: requests.inputTokenCount,
				cachedInputTokenCount: requests.cachedInputTokenCount,
				cacheWriteTokenCount: requests.cacheWriteTokenCount,
				outputTokenCount: requests.outputTokenCount,
				searchUnits: requests.searchUnits,
			})
			.from(requests)
			.where(
				and(
					gte(requests.requestTime, range.start.toISOString()),
					lt(requests.requestTime, range.end.toISOString()),
				),
			);
		const rowsByBucket = new Map<string, typeof rows>();
		for (const row of rows) {
			if (!row.requestTime) continue;
			const key = floorUtcHour(new Date(row.requestTime)).toISOString();
			const bucketRows = rowsByBucket.get(key) ?? [];
			bucketRows.push(row);
			rowsByBucket.set(key, bucketRows);
		}
		for (const bucket of missingBuckets.filter(
			(candidate) => candidate >= range.start && candidate < range.end,
		)) {
			preparedBuckets.push(
				buildBucketValues(
					bucket,
					rowsByBucket.get(bucket.toISOString()) ?? [],
					costStageRows,
					costStageIndex,
				),
			);
		}
	}
	await persistBuckets(database, preparedBuckets);
}

export async function ensureRequestStatisticsCache(
	database: AppDatabase,
	start: Date,
	end: Date,
) {
	await populate(database, start, end, false);
}

export async function rebuildRequestStatisticsCache(
	database: AppDatabase,
	start: Date,
	end: Date,
) {
	await populate(database, start, end, true);
}

export function cachedRowToAggregates(row: RequestStatisticsCacheRow) {
	return {
		total: toCostAggregate(row),
		breakdown: toBreakdownAggregate(row),
	};
}

export function mergeCachedTotalCost(
	target: CostAggregate,
	row: RequestStatisticsCacheRow,
) {
	addTotalCostAggregate(target, toCostAggregate(row));
}

export function mergeCachedBreakdownCost(
	target: BreakdownAggregate,
	row: RequestStatisticsCacheRow,
) {
	addBreakdownCostAggregate(target, toBreakdownAggregate(row));
}
