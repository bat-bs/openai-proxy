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
 *   outputCost: CostPartResolution;
 * }} BreakdownCostResolution
 */

/**
 * @typedef {{
 *   missing: boolean;
 *   currency: string | null;
 *   totalCostScaled: bigint;
 * }} TotalCostAggregate
 */

/**
 * @typedef {{
 *   missing: boolean;
 *   currency: string | null;
 *   inputCostScaled: bigint;
 *   cachedCostScaled: bigint;
 *   outputCostScaled: bigint;
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
 * @returns {TotalCostAggregate}
 */
export function createTotalCostAggregate() {
	return {
		missing: false,
		currency: null,
		totalCostScaled: 0n,
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
	aggregate.currency = mergeCurrency(aggregate.currency, resolved.currency);
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
		};
	}

	return {
		missing: false,
		cost: scaledCostToNumber(aggregate.totalCostScaled),
		currency: aggregate.currency,
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
		outputCostScaled: 0n,
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
	aggregate.outputCostScaled += scaleCost(resolved.outputCost.cost);
	aggregate.currency = mergeCurrency(aggregate.currency, resolved.currency);
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
			outputCost: null,
			totalCost: null,
			currency: null,
		};
	}

	const inputCost = scaledCostToNumber(aggregate.inputCostScaled);
	const cachedCost = scaledCostToNumber(aggregate.cachedCostScaled);
	const outputCost = scaledCostToNumber(aggregate.outputCostScaled);

	return {
		missing: false,
		inputCost,
		cachedCost,
		outputCost,
		totalCost: inputCost + cachedCost + outputCost,
		currency: aggregate.currency,
	};
}
