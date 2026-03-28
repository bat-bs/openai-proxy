import assert from "node:assert/strict";
import test from "node:test";

import {
	addResolvedBreakdownCost,
	addResolvedTotalCost,
	createBreakdownCostAggregate,
	createTotalCostAggregate,
	presentBreakdownCost,
	presentTotalCost,
} from "./costAggregation.js";

test("total cost aggregation keeps resolved rows after missing rows", () => {
	const firstOrder = createTotalCostAggregate();
	addResolvedTotalCost(firstOrder, {
		missing: true,
		totalCost: 0,
		currency: null,
	});
	addResolvedTotalCost(firstOrder, {
		missing: false,
		totalCost: 1.25,
		currency: "eur",
	});
	addResolvedTotalCost(firstOrder, {
		missing: false,
		totalCost: 2.5,
		currency: "EUR",
	});

	const secondOrder = createTotalCostAggregate();
	addResolvedTotalCost(secondOrder, {
		missing: false,
		totalCost: 2.5,
		currency: "EUR",
	});
	addResolvedTotalCost(secondOrder, {
		missing: true,
		totalCost: 0,
		currency: null,
	});
	addResolvedTotalCost(secondOrder, {
		missing: false,
		totalCost: 1.25,
		currency: "EUR",
	});

	assert.equal(firstOrder.missing, true);
	assert.equal(secondOrder.missing, true);
	assert.equal(firstOrder.totalCostScaled, 375000000n);
	assert.equal(secondOrder.totalCostScaled, 375000000n);
	assert.deepEqual(presentTotalCost(firstOrder), {
		missing: true,
		cost: null,
		currency: null,
	});
});

test("breakdown aggregation keeps resolved parts after missing rows", () => {
	const aggregate = createBreakdownCostAggregate();
	addResolvedBreakdownCost(aggregate, {
		missing: true,
		currency: null,
		inputCost: { cost: 0 },
		cachedCost: { cost: 0 },
		outputCost: { cost: 0 },
	});
	addResolvedBreakdownCost(aggregate, {
		missing: false,
		currency: "EUR",
		inputCost: { cost: 0.5 },
		cachedCost: { cost: 0.25 },
		outputCost: { cost: 0.75 },
	});

	assert.equal(aggregate.missing, true);
	assert.equal(aggregate.inputCostScaled, 50000000n);
	assert.equal(aggregate.cachedCostScaled, 25000000n);
	assert.equal(aggregate.outputCostScaled, 75000000n);
	assert.deepEqual(presentBreakdownCost(aggregate), {
		missing: true,
		inputCost: null,
		cachedCost: null,
		outputCost: null,
		totalCost: null,
		currency: null,
	});
});
