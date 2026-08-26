import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyConflict,
	evaluateRules,
	matchesRule,
	normalizeAzurePrice,
	substituteTemplate,
} from "./azurePricing";

describe("Azure pricing rules", () => {
	it("matches all conditions and substitutes named captures", () => {
		const row = { meterName: "Input tokens", productName: "gpt-4o" };
		const rule = {
			name: "chat",
			enabled: true,
			priority: 1,
			action: "map" as const,
			conditions: [
				{ field: "meterName", operator: "contains" as const, value: "tokens" },
				{
					field: "productName",
					operator: "regex" as const,
					value: "(?<model>gpt-[\\w-]+)",
				},
			],
			assignments: { model: ["$", "{model}"].join("") },
		};
		assert.equal(matchesRule(row, rule), true);
		assert.equal(
			substituteTemplate(["$", "{model}"].join(""), { model: "gpt-4o" }),
			"gpt-4o",
		);
		assert.equal(
			evaluateRules(row, [rule], new Set(["gpt-4o"])).assignments?.model,
			"gpt-4o",
		);
	});
	it("gives ignore rules precedence and detects priority ambiguity", () => {
		const base = {
			enabled: true,
			priority: 1,
			conditions: [],
			assignments: { model: "a" },
		};
		const ignore = { ...base, name: "ignore", action: "ignore" as const };
		assert.equal(
			evaluateRules({}, [base as never, ignore], new Set(["a"])).status,
			"ignored",
		);
		const second = { ...base, name: "b", assignments: { model: "b" } };
		assert.equal(
			evaluateRules(
				{},
				[
					{ ...base, name: "a", action: "map" as const },
					{ ...second, action: "map" as const },
				],
				new Set(["a", "b"]),
			).status,
			"invalid",
		);
	});
	it("composes fields from multiple rules and canonicalizes token types", () => {
		const rules = [
			{
				name: "model",
				enabled: true,
				priority: 10,
				action: "map" as const,
				conditions: [],
				assignments: { model: "gpt-4o" },
			},
			{
				name: "request",
				enabled: true,
				priority: 5,
				action: "map" as const,
				conditions: [],
				assignments: {
					requestType: "CHAT_COMPLETION" as const,
					billingUnit: "TOKENS" as const,
				},
			},
			{
				name: "input",
				enabled: true,
				priority: 1,
				action: "map" as const,
				conditions: [],
				assignments: { tokenType: "prompt" },
			},
		];
		const result = evaluateRules({}, rules, new Set(["gpt-4o"]));
		assert.equal(result.status, "mapped");
		assert.equal(result.assignments?.tokenType, "input");
	});
	it("reports rows with no matching rule as unmapped", () => {
		assert.equal(evaluateRules({}, [], new Set()).status, "unmapped");
	});
	it("rejects invalid stage assignments", () => {
		const result = evaluateRules(
			{},
			[
				{
					name: "invalid-stage",
					enabled: true,
					priority: 1,
					action: "map",
					conditions: [],
					assignments: {
						model: "gpt-4o",
						requestType: "CHAT_COMPLETION",
						billingUnit: "TOKENS",
						tokenType: "input",
						stageMinTokens: 100,
						stageMaxTokens: 99,
					},
				},
			],
			new Set(["gpt-4o"]),
		);
		assert.equal(result.status, "invalid");
	});
});

describe("Azure price normalization and conflicts", () => {
	it("normalizes 1K prices to integer cents per million", () => {
		assert.equal(
			normalizeAzurePrice(
				{
					retailPrice: 0.001234,
					unitOfMeasure: "1K Tokens",
					currencyCode: "EUR",
					effectiveStartDate: "2026-01-01",
				},
				"EUR",
			).price,
			123,
		);
	});
	it("classifies history decisions", () => {
		assert.equal(
			classifyConflict(
				{ validFrom: "2026-02-01", price: 10 },
				{ validFrom: "2026-01-01", price: 9 },
			),
			"insert",
		);
		assert.equal(
			classifyConflict(
				{ validFrom: "2026-01-01", price: 10 },
				{ validFrom: "2026-01-01", price: 9 },
				"replace",
			),
			"replace",
		);
		assert.equal(
			classifyConflict(
				{ validFrom: "2026-01-01", price: 10 },
				{ validFrom: "2026-01-01", price: 9 },
			),
			"skip",
		);
		assert.equal(
			classifyConflict(
				{ validFrom: "2025-01-01", price: 10 },
				{ validFrom: "2026-01-01", price: 9 },
			),
			"older",
		);
		assert.equal(
			classifyConflict(
				{ validFrom: "2026-01-01", price: 9 },
				{ validFrom: "2026-01-01", price: 9 },
			),
			"unchanged",
		);
	});
	it("rejects unsupported units and mismatched currencies", () => {
		assert.ok(
			"error" in
				normalizeAzurePrice(
					{
						retailPrice: 1,
						unitOfMeasure: "1 Hour",
						currencyCode: "EUR",
						effectiveStartDate: "2026-01-01",
					},
					"EUR",
				),
		);
		assert.ok(
			"error" in
				normalizeAzurePrice(
					{
						retailPrice: 1,
						unitOfMeasure: "1M Tokens",
						currencyCode: "USD",
						effectiveStartDate: "2026-01-01",
					},
					"EUR",
				),
		);
	});
});
