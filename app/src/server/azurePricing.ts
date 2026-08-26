import {
	BillingUnit,
	canonicalizeCostTokenType,
	RequestType,
} from "~/lib/costs";

export type AzureRow = Record<string, unknown>;
export type AzureCondition = {
	field: string;
	operator: "equals" | "contains" | "regex";
	value: string;
};
export type AzureAssignments = Partial<{
	model: string;
	requestType: "CHAT_COMPLETION" | "RERANK";
	billingUnit: "TOKENS" | "SEARCHES";
	tokenType: string;
	stageMinTokens: string | number;
	stageMaxTokens: string | number | null;
}>;
export type AzureRule = {
	id?: number;
	name: string;
	enabled: boolean;
	priority: number;
	action: "map" | "ignore";
	conditions: AzureCondition[];
	assignments: AzureAssignments;
};

function value(row: AzureRow, field: string) {
	const result = row[field];
	return result === undefined || result === null ? "" : String(result);
}

function captures(row: AzureRow, conditions: AzureCondition[]) {
	const result: Record<string, string> = {};
	for (const condition of conditions) {
		if (condition.operator !== "regex") continue;
		const match = new RegExp(condition.value, "i").exec(
			value(row, condition.field),
		);
		if (match?.groups) Object.assign(result, match.groups);
	}
	return result;
}

export function matchesRule(row: AzureRow, rule: AzureRule) {
	try {
		return rule.conditions.every((condition) => {
			const actual = value(row, condition.field);
			if (condition.operator === "equals")
				return actual.toLowerCase() === condition.value.toLowerCase();
			if (condition.operator === "contains")
				return actual.toLowerCase().includes(condition.value.toLowerCase());
			return new RegExp(condition.value, "i").test(actual);
		});
	} catch {
		return false;
	}
}

export function substituteTemplate(
	input: string | number | null | undefined,
	groups: Record<string, string>,
) {
	if (input === null || input === undefined) return input;
	return String(input).replace(
		/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g,
		(_, name: string) => groups[name] ?? "",
	);
}

export function evaluateRules(
	row: AzureRow,
	rules: AzureRule[],
	modelIds: Set<string>,
) {
	const matching = rules
		.filter((rule) => rule.enabled && matchesRule(row, rule))
		.sort((a, b) => b.priority - a.priority);
	const names = matching.map((rule) => rule.name);
	if (matching.some((rule) => rule.action === "ignore"))
		return {
			status: "ignored" as const,
			matchingRuleNames: names,
			errors: [] as string[],
		};
	if (!matching.length)
		return {
			status: "unmapped" as const,
			matchingRuleNames: names,
			errors: ["No mapping rule matched"],
		};
	const assignments: AzureAssignments = {};
	const errors: string[] = [];
	const fields = [
		"model",
		"requestType",
		"billingUnit",
		"tokenType",
		"stageMinTokens",
		"stageMaxTokens",
	] as const;
	for (const field of fields) {
		const providers = matching.filter(
			(rule) => rule.action === "map" && rule.assignments[field] !== undefined,
		);
		if (!providers.length) continue;
		const highest = providers[0]?.priority ?? 0;
		const values = providers
			.filter((rule) => rule.priority === highest)
			.map(
				(rule) =>
					substituteTemplate(
						rule.assignments[field],
						captures(row, rule.conditions),
					) ?? null,
			);
		if (new Set(values.map(String)).size > 1)
			errors.push(`Ambiguous ${field} at priority ${highest}`);
		else assignments[field] = values[0] as never;
	}
	if (!assignments.model || !modelIds.has(String(assignments.model)))
		errors.push("Mapped model does not exist");
	const requestType = assignments.requestType;
	if (
		requestType !== RequestType.ChatCompletion &&
		requestType !== RequestType.Rerank
	)
		errors.push("Request type is required");
	const expectedUnit =
		requestType === RequestType.Rerank
			? BillingUnit.Searches
			: BillingUnit.Tokens;
	if (assignments.billingUnit !== expectedUnit)
		errors.push("Billing unit does not agree with request type");
	if (requestType === RequestType.ChatCompletion) {
		const tokenType = canonicalizeCostTokenType(
			String(assignments.tokenType ?? ""),
		);
		if (!tokenType) errors.push("Token type is required for chat completion");
		else assignments.tokenType = tokenType;
	}
	if (requestType === RequestType.Rerank && assignments.tokenType)
		errors.push("Rerank cannot have a token type");
	for (const field of ["stageMinTokens", "stageMaxTokens"] as const) {
		if (
			assignments[field] === undefined ||
			assignments[field] === null ||
			assignments[field] === ""
		)
			continue;
		const number = Number(assignments[field]);
		if (!Number.isInteger(number) || number < 0)
			errors.push(`${field} must be a non-negative integer`);
		else assignments[field] = number;
	}
	if (
		assignments.stageMaxTokens !== undefined &&
		assignments.stageMaxTokens !== null &&
		Number(assignments.stageMaxTokens) < Number(assignments.stageMinTokens ?? 0)
	)
		errors.push("Stage maximum must be at least the minimum");
	return {
		status: errors.length ? ("invalid" as const) : ("mapped" as const),
		matchingRuleNames: names,
		assignments,
		errors,
	};
}

export function normalizeAzurePrice(row: AzureRow, currency: string) {
	const price = Number(row.retailPrice);
	const unit = value(row, "unitOfMeasure").toLowerCase();
	const multiplier = /(?:per\s*)?1\s*k\b|1000/.test(unit)
		? 1000
		: /(?:per\s*)?1\s*m\b|million/.test(unit)
			? 1
			: 0;
	const date = new Date(String(row.effectiveStartDate));
	const rowCurrency = value(row, "currencyCode").trim().toUpperCase();
	if (
		!Number.isFinite(price) ||
		price < 0 ||
		multiplier === 0 ||
		Number.isNaN(date.getTime()) ||
		!/^[A-Z]{3}$/.test(rowCurrency) ||
		rowCurrency !== currency.toUpperCase()
	)
		return { error: "Invalid Azure price, unit, date, or currency" };
	return {
		price: Math.round(price * multiplier * 100),
		validFrom: date.toISOString().slice(0, 10),
		currency: rowCurrency,
		unitOfMessure: "1M" as const,
	};
}

export type CostIdentity = {
	model: string;
	requestType: string;
	billingUnit: string;
	tokenType: string | null;
	unitOfMessure: string;
	currency: string;
	stageType: string;
	stageMinTokens: number;
	stageMaxTokens: number | null;
};

export function buildCostIdentity(
	assignments: AzureAssignments,
	currency: string,
): CostIdentity {
	const requestType = String(assignments.requestType ?? "");
	return {
		model: String(assignments.model ?? ""),
		requestType,
		billingUnit: String(assignments.billingUnit ?? ""),
		tokenType:
			requestType === RequestType.Rerank
				? null
				: canonicalizeCostTokenType(String(assignments.tokenType ?? "")),
		unitOfMessure: "1M",
		currency,
		stageType: "context_length",
		stageMinTokens: Number(assignments.stageMinTokens ?? 0),
		stageMaxTokens:
			assignments.stageMaxTokens === null ||
			assignments.stageMaxTokens === undefined ||
			assignments.stageMaxTokens === ""
				? null
				: Number(assignments.stageMaxTokens),
	};
}

export function costIdentity(row: CostIdentity) {
	return JSON.stringify(row);
}
export function classifyConflict(
	incoming: { validFrom: string; price: number },
	latest?: { validFrom: string; price: number },
	decision: "skip" | "replace" = "skip",
) {
	if (!latest || incoming.validFrom > latest.validFrom)
		return "insert" as const;
	if (incoming.validFrom < latest.validFrom) return "older" as const;
	if (incoming.price === latest.price) return "unchanged" as const;
	return decision === "replace" ? ("replace" as const) : ("skip" as const);
}
