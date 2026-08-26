const COST_SCALE = 100000000n;
const COST_SCALE_NUMBER = Number(COST_SCALE);

/**
 * @typedef {{
 *   missing: boolean;
 *   totalCost: number;
 *   currency: string | null;
 * }} TotalCostResolution
 */

/**
 * @typedef {{
 *   cost: number;
 * }} CostPartResolution
 */

/**
 * @typedef {{
 *   missing: boolean;
 *   currency: string | null;
 *   inputCost: CostPartResolution;
 *   cachedCost: CostPartResolution;
 *   cacheWriteCost: CostPartResolution;
 *   outputCost: CostPartResolution;
 *   searchCost?: CostPartResolution;
 * }} BreakdownCostResolution
 */

/**
 * @typedef {{
 *   missing: boolean;
 *   currency: string | null;
 *   totalCostScaled: bigint;
 *   currencyTotals: Map<string, bigint>;
 *   currencyIssue: boolean;
 * }} TotalCostAggregate
 */

/**
 * @typedef {{
 *   missing: boolean;
 *   currency: string | null;
 *   inputCostScaled: bigint;
 *   cachedCostScaled: bigint;
 *   cacheWriteCostScaled: bigint;
 *   outputCostScaled: bigint;
 *   searchCostScaled: bigint;
 *   currencyTotals: Map<string, bigint>;
 *   currencyIssue: boolean;
 * }} BreakdownCostAggregate
 */

/**
 * @param {number | null | undefined} value
 */
function scaleCost(value) {
	return BigInt(Math.round((value ?? 0) * COST_SCALE_NUMBER));
}

/**
 * @param {bigint} value
 */
export function scaledCostToNumber(value) {
	return Number(value) / COST_SCALE_NUMBER;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeCurrency(value) {
	const currency = value?.trim().toUpperCase() ?? null;
	return currency && currency.length > 0 ? currency : null;
}

/**
 * @param {string | null} current
 * @param {string | null | undefined} next
 */
export function mergeCurrency(current, next) {
	const normalizedNext = normalizeCurrency(next);
	if (normalizedNext === null) {
		return current;
	}
	if (current === null) {
		return normalizedNext;
	}
	return current === normalizedNext ? current : null;
}

/**
 * @param {string | null} current
 * @param {string | null | undefined} next
 */
export function mergeCurrencyState(current, next) {
	const normalizedNext = normalizeCurrency(next);
	if (normalizedNext === null) {
		return { currency: current, issue: true };
	}
	if (current === null) {
		return { currency: normalizedNext, issue: false };
	}
	return current === normalizedNext
		? { currency: current, issue: false }
		: { currency: null, issue: true };
}

export function createCurrencyTotals() {
	return new Map();
}

/**
 * @param {Map<string, bigint>} currencyTotals
 * @param {string | null | undefined} currency
 * @param {number | null | undefined} cost
 */
export function addCurrencyTotal(currencyTotals, currency, cost) {
	const normalizedCurrency = normalizeCurrency(currency);
	if (normalizedCurrency === null) return;
	const scaledCost = scaleCost(cost);
	currencyTotals.set(
		normalizedCurrency,
		(currencyTotals.get(normalizedCurrency) ?? 0n) + scaledCost,
	);
}

/**
 * @param {Map<string, bigint>} currencyTotals
 */
export function presentCurrencyTotals(currencyTotals) {
	return Array.from(currencyTotals.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([currency, totalCostScaled]) => ({
			currency,
			totalCost: scaledCostToNumber(totalCostScaled),
		}));
}

/**
 * @returns {TotalCostAggregate}
 */
export function createTotalCostAggregate() {
	return {
		missing: false,
		currency: null,
		totalCostScaled: 0n,
		currencyTotals: createCurrencyTotals(),
		currencyIssue: false,
	};
}

/**
 * @param {TotalCostAggregate} aggregate
 * @param {TotalCostResolution} resolved
 */
export function addResolvedTotalCost(aggregate, resolved) {
	if (resolved.missing) {
		aggregate.missing = true;
		return aggregate;
	}

	aggregate.totalCostScaled += scaleCost(resolved.totalCost);
	addCurrencyTotal(
		aggregate.currencyTotals,
		resolved.currency,
		resolved.totalCost,
	);
	const currencyState = mergeCurrencyState(
		aggregate.currency,
		resolved.currency,
	);
	aggregate.currency = currencyState.currency;
	aggregate.currencyIssue ||= currencyState.issue;
	return aggregate;
}

/**
 * Merge an already-resolved total-cost aggregate into another aggregate.
 * This is used by report caches, where individual requests have already
 * been resolved with the correct price stage.
 *
 * @param {TotalCostAggregate} aggregate
 * @param {TotalCostAggregate} source
 */
export function addTotalCostAggregate(aggregate, source) {
	if (source.missing) {
		aggregate.missing = true;
		return aggregate;
	}

	aggregate.totalCostScaled += source.totalCostScaled;
	for (const [currency, total] of source.currencyTotals) {
		aggregate.currencyTotals.set(
			currency,
			(aggregate.currencyTotals.get(currency) ?? 0n) + total,
		);
	}
	const currencyState = mergeCurrencyState(aggregate.currency, source.currency);
	aggregate.currency = currencyState.currency;
	aggregate.currencyIssue ||= source.currencyIssue || currencyState.issue;
	return aggregate;
}

/**
 * @param {TotalCostAggregate | undefined} aggregate
 */
export function presentTotalCost(aggregate) {
	if (!aggregate || aggregate.missing) {
		return {
			missing: true,
			cost: null,
			currency: null,
			currencyTotals: presentCurrencyTotals(
				aggregate?.currencyTotals ?? new Map(),
			),
		};
	}

	return {
		missing: false,
		currencyIssue: aggregate.currencyIssue,
		currencyTotals: presentCurrencyTotals(aggregate.currencyTotals),
		cost: aggregate.currencyIssue
			? null
			: scaledCostToNumber(aggregate.totalCostScaled),
		currency: aggregate.currencyIssue ? null : aggregate.currency,
	};
}

/**
 * @returns {BreakdownCostAggregate}
 */
export function createBreakdownCostAggregate() {
	return {
		missing: false,
		currency: null,
		inputCostScaled: 0n,
		cachedCostScaled: 0n,
		cacheWriteCostScaled: 0n,
		outputCostScaled: 0n,
		searchCostScaled: 0n,
		currencyTotals: createCurrencyTotals(),
		currencyIssue: false,
	};
}

/**
 * @param {BreakdownCostAggregate} aggregate
 * @param {BreakdownCostResolution} resolved
 */
export function addResolvedBreakdownCost(aggregate, resolved) {
	if (resolved.missing) {
		aggregate.missing = true;
		return aggregate;
	}

	aggregate.inputCostScaled += scaleCost(resolved.inputCost.cost);
	aggregate.cachedCostScaled += scaleCost(resolved.cachedCost.cost);
	aggregate.cacheWriteCostScaled += scaleCost(resolved.cacheWriteCost.cost);
	aggregate.outputCostScaled += scaleCost(resolved.outputCost.cost);
	addCurrencyTotal(
		aggregate.currencyTotals,
		resolved.currency,
		resolved.inputCost.cost +
			resolved.cachedCost.cost +
			resolved.cacheWriteCost.cost +
			resolved.outputCost.cost +
			(resolved.searchCost?.cost ?? 0),
	);
	if (resolved.searchCost) {
		aggregate.searchCostScaled += scaleCost(resolved.searchCost.cost);
	}
	const currencyState = mergeCurrencyState(
		aggregate.currency,
		resolved.currency,
	);
	aggregate.currency = currencyState.currency;
	aggregate.currencyIssue ||= currencyState.issue;
	return aggregate;
}

/**
 * Merge an already-resolved breakdown-cost aggregate into another aggregate.
 *
 * @param {BreakdownCostAggregate} aggregate
 * @param {BreakdownCostAggregate} source
 */
export function addBreakdownCostAggregate(aggregate, source) {
	if (source.missing) {
		aggregate.missing = true;
		return aggregate;
	}

	aggregate.inputCostScaled += source.inputCostScaled;
	aggregate.cachedCostScaled += source.cachedCostScaled;
	aggregate.cacheWriteCostScaled += source.cacheWriteCostScaled;
	aggregate.outputCostScaled += source.outputCostScaled;
	aggregate.searchCostScaled += source.searchCostScaled;
	for (const [currency, total] of source.currencyTotals) {
		aggregate.currencyTotals.set(
			currency,
			(aggregate.currencyTotals.get(currency) ?? 0n) + total,
		);
	}
	const currencyState = mergeCurrencyState(aggregate.currency, source.currency);
	aggregate.currency = currencyState.currency;
	aggregate.currencyIssue ||= source.currencyIssue || currencyState.issue;
	return aggregate;
}

/**
 * @param {BreakdownCostAggregate | undefined} aggregate
 */
export function presentBreakdownCost(aggregate) {
	if (!aggregate || aggregate.missing) {
		return {
			missing: true,
			inputCost: null,
			cachedCost: null,
			cacheWriteCost: null,
			outputCost: null,
			searchCost: null,
			totalCost: null,
			currency: null,
			currencyTotals: presentCurrencyTotals(
				aggregate?.currencyTotals ?? new Map(),
			),
		};
	}

	const inputCost = scaledCostToNumber(aggregate.inputCostScaled);
	const cachedCost = scaledCostToNumber(aggregate.cachedCostScaled);
	const cacheWriteCost = scaledCostToNumber(aggregate.cacheWriteCostScaled);
	const outputCost = scaledCostToNumber(aggregate.outputCostScaled);
	const searchCost = scaledCostToNumber(aggregate.searchCostScaled);

	return {
		missing: false,
		currencyIssue: aggregate.currencyIssue,
		currencyTotals: presentCurrencyTotals(aggregate.currencyTotals),
		inputCost,
		cachedCost,
		cacheWriteCost,
		outputCost,
		searchCost,
		totalCost: aggregate.currencyIssue
			? null
			: inputCost + cachedCost + cacheWriteCost + outputCost + searchCost,
		currency: aggregate.currencyIssue ? null : aggregate.currency,
	};
}
