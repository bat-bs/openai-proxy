import type { BillingUnit, RequestType } from "~/lib/costs";
import {
	type CostTokenType,
	type CostUnit,
	canonicalizeCostTokenType,
} from "~/lib/costs";

const ContextLengthStageType = "context_length" as const;

type CanonicalTokenType = CostTokenType;

export type CostStageRow = {
	model: string;
	requestType?: RequestType;
	billingUnit?: BillingUnit;
	tokenType: string;
	price: number;
	validFrom: string | Date;
	unitOfMessure: CostUnit | null;
	currency: string | null;
	stageType: string;
	stageMinTokens: number;
	stageMaxTokens: number | null;
};

export type TokenCostStageResolutionResult = {
	cost: number;
	currency: string | null; // empty when missing (handled via `missing`)
	unit: CostUnit | null;
	usedCost: CostStageRow | null;
	missing: boolean;
	ambiguous: boolean;
};

export type RequestCostStageResolutionResult = {
	totalCost: number;
	currency: string | null;
	missing: boolean;
	inputCost: TokenCostStageResolutionResult;
	cachedCost: TokenCostStageResolutionResult;
	cacheWriteCost: TokenCostStageResolutionResult;
	outputCost: TokenCostStageResolutionResult;
};

export type RerankCostResolutionResult = {
	cost: number;
	currency: string | null;
	unit: CostUnit | null;
	usedCost: CostStageRow | null;
	missing: boolean;
	ambiguous: boolean;
};

function normalizeKey(s: string) {
	return s.trim().toLowerCase();
}

function toMs(value: string | Date | null | undefined) {
	if (!value) return 0;
	return new Date(value).getTime();
}

function unitDivisor(unit: CostUnit | null) {
	if (unit === "1K") return 1_000;
	// Default: treat unknown/null as "1M" to avoid exploding on partial data.
	return 1_000_000;
}

function priceToCurrency(priceCents: number) {
	return priceCents / 100;
}

function stageContains(
	stageMin: number,
	stageMax: number | null,
	inputTokens: number,
) {
	if (inputTokens < stageMin) return false;
	if (stageMax === null) return true;
	return inputTokens <= stageMax;
}

function tokenTypeLabelWithStage(
	tokenType: CanonicalTokenType,
	stageMin: number,
	stageMax: number | null,
) {
	return stageMax === null
		? `${tokenType} (${stageMin}..∞)`
		: `${tokenType} (${stageMin}..${stageMax})`;
}

export function buildCostStageIndex(costRows: CostStageRow[]) {
	const index = new Map<string, CostStageRow[]>();

	for (const row of costRows) {
		const modelKey = normalizeKey(row.model);
		const tokenKey =
			canonicalizeCostTokenType(row.tokenType) ?? normalizeKey(row.tokenType);
		const stageTypeKey = normalizeKey(row.stageType || ContextLengthStageType);

		// tokenKey is canonicalized to input/cached/output when possible.
		const requestType = row.requestType ?? "CHAT_COMPLETION";
		const billingUnit = row.billingUnit ?? "TOKENS";
		const key = `${modelKey}|${requestType}|${billingUnit}|${tokenKey}|${stageTypeKey}`;
		const existing = index.get(key) ?? [];
		existing.push(row);
		index.set(key, existing);
	}

	return index;
}

export function resolveTokenCostStage(
	costRowsForKey: CostStageRow[],
	opts: {
		requestTime: Date;
		stageType?: string;
		inputTokensForStage: number;
		tokensToBill: number;
	},
): TokenCostStageResolutionResult {
	if (opts.tokensToBill <= 0) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: false,
			ambiguous: false,
		};
	}

	if (!costRowsForKey.length) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}

	const requestTimeMs = opts.requestTime.getTime();

	// 1) Select newest valid_from <= request_time
	let latestValidFromMs = -Infinity;
	for (const c of costRowsForKey) {
		const validFromMs = toMs(c.validFrom);
		if (validFromMs <= requestTimeMs && validFromMs > latestValidFromMs) {
			latestValidFromMs = validFromMs;
		}
	}

	if (!Number.isFinite(latestValidFromMs)) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}

	const candidatesAtLatest = costRowsForKey.filter(
		(c) => toMs(c.validFrom) === latestValidFromMs,
	);

	// 2) Select stage whose range contains request input_token_count
	const matchingStages = candidatesAtLatest.filter((c) =>
		stageContains(c.stageMinTokens, c.stageMaxTokens, opts.inputTokensForStage),
	);

	if (!matchingStages.length) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}

	// Deterministic tie-break:
	// - highest stage_min_tokens wins
	// - then lowest stage_max_tokens wins (treat NULL as +Inf)
	let best = matchingStages[0];
	if (!best) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}
	let bestMax = best.stageMaxTokens ?? Number.POSITIVE_INFINITY;

	for (const c of matchingStages.slice(1)) {
		const cMax = c.stageMaxTokens ?? Number.POSITIVE_INFINITY;

		if (c.stageMinTokens > best.stageMinTokens) {
			best = c;
			bestMax = cMax;
			continue;
		}
		if (c.stageMinTokens === best.stageMinTokens && cMax < bestMax) {
			best = c;
			bestMax = cMax;
		}
	}

	// If multiple rows have the exact same stage bounds, ensure they agree on price/unit/currency.
	const bestUnit = best.unitOfMessure ?? null;
	const bestCurrency = best.currency?.trim() ?? null;

	let conflicts = 0;
	for (const c of matchingStages) {
		const sameMax =
			(best.stageMaxTokens === null && c.stageMaxTokens === null) ||
			(best.stageMaxTokens !== null &&
				c.stageMaxTokens !== null &&
				best.stageMaxTokens === c.stageMaxTokens);

		if (c.stageMinTokens === best.stageMinTokens && sameMax) {
			const cUnit = c.unitOfMessure ?? null;
			const cCurrency = c.currency?.trim() ?? null;

			if (
				c.price !== best.price ||
				cUnit !== bestUnit ||
				cCurrency !== bestCurrency
			) {
				conflicts += 1;
			}
		}
	}

	if (conflicts > 0) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: true,
		};
	}

	const divisor = unitDivisor(best.unitOfMessure);
	const cost = (opts.tokensToBill / divisor) * priceToCurrency(best.price);

	return {
		cost,
		currency: best.currency?.trim() ?? null,
		unit: best.unitOfMessure ?? null,
		usedCost: best,
		missing: false,
		ambiguous: false,
	};
}

export function resolveRequestCostStage(
	costStageIndex: Map<string, CostStageRow[]>,
	req: {
		model: string;
		requestTime: Date;
		inputTokenCount: number;
		cachedInputTokenCount: number;
		cacheWriteTokenCount: number;
		outputTokenCount: number;
		stageType?: string;
	},
): RequestCostStageResolutionResult {
	const stageType = req.stageType?.trim() || ContextLengthStageType;

	const cachedTokens = Math.max(0, req.cachedInputTokenCount);
	const cacheWriteTokens = Math.max(0, req.cacheWriteTokenCount);
	const promptTokens = Math.max(
		0,
		req.inputTokenCount - cachedTokens - cacheWriteTokens,
	);
	const outputTokens = Math.max(0, req.outputTokenCount);

	const modelKey = normalizeKey(req.model);
	const stageTypeKey = normalizeKey(stageType);

	const resolveForTokenType = (
		tokenType: CanonicalTokenType,
		tokensToBill: number,
	) => {
		const key = `${modelKey}|CHAT_COMPLETION|TOKENS|${tokenType}|${stageTypeKey}`;
		const costRowsForKey = costStageIndex.get(key) ?? [];
		return resolveTokenCostStage(costRowsForKey, {
			requestTime: req.requestTime,
			inputTokensForStage: req.inputTokenCount,
			tokensToBill,
		});
	};

	const inputCost = resolveForTokenType("input", promptTokens);
	const cachedCost = resolveForTokenType("cached", cachedTokens);
	const cacheWriteCost = resolveForTokenType("cache_write", cacheWriteTokens);
	const outputCost = resolveForTokenType("output", outputTokens);

	const missing =
		inputCost.missing ||
		cachedCost.missing ||
		cacheWriteCost.missing ||
		outputCost.missing;
	if (missing) {
		return {
			totalCost: 0,
			currency: null,
			missing: true,
			inputCost,
			cachedCost,
			cacheWriteCost,
			outputCost,
		};
	}

	const currencies = [
		inputCost.usedCost?.currency,
		cachedCost.usedCost?.currency,
		cacheWriteCost.usedCost?.currency,
		outputCost.usedCost?.currency,
	]
		.filter((c): c is string => Boolean(c))
		.map((c) => c.trim());

	let currency: string | null = null;
	if (currencies.length > 0) {
		const first = currencies[0];
		if (first !== undefined && currencies.every((c) => c === first)) {
			currency = first;
		}
	}

	return {
		totalCost:
			inputCost.cost + cachedCost.cost + cacheWriteCost.cost + outputCost.cost,
		currency,
		missing: false,
		inputCost,
		cachedCost,
		cacheWriteCost,
		outputCost,
	};
}

export function resolveRerankCost(
	costRows: CostStageRow[],
	request: {
		model: string;
		requestTime: Date;
		searchUnits: number;
	},
): RerankCostResolutionResult {
	if (request.searchUnits <= 0) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: false,
			ambiguous: false,
		};
	}

	const candidates = costRows.filter(
		(row) =>
			normalizeKey(row.model) === normalizeKey(request.model) &&
			(row.requestType ?? "CHAT_COMPLETION") === "RERANK" &&
			(row.billingUnit ?? "TOKENS") === "SEARCHES" &&
			toMs(row.validFrom) <= request.requestTime.getTime(),
	);
	if (!candidates.length) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}

	const latest = Math.max(...candidates.map((row) => toMs(row.validFrom)));
	const matching = candidates.filter((row) => toMs(row.validFrom) === latest);
	const best = matching[0];
	if (!best) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: false,
		};
	}
	const ambiguous = matching.some(
		(row) =>
			row.price !== best.price ||
			row.unitOfMessure !== best.unitOfMessure ||
			(row.currency ?? null) !== (best.currency ?? null),
	);
	if (ambiguous) {
		return {
			cost: 0,
			currency: null,
			unit: null,
			usedCost: null,
			missing: true,
			ambiguous: true,
		};
	}

	return {
		cost:
			(request.searchUnits / unitDivisor(best.unitOfMessure)) *
			priceToCurrency(best.price),
		currency: best.currency?.trim() ?? null,
		unit: best.unitOfMessure ?? null,
		usedCost: best,
		missing: false,
		ambiguous: false,
	};
}

export { tokenTypeLabelWithStage };
