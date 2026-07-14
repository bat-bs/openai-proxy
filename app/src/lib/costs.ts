export const costUnitOptions = ["1M", "1K"] as const;

export type CostUnit = (typeof costUnitOptions)[number];

export const requestTypeOptions = ["CHAT_COMPLETION", "RERANK"] as const;
export type RequestType = (typeof requestTypeOptions)[number];
export const RequestType = {
	ChatCompletion: "CHAT_COMPLETION",
	Rerank: "RERANK",
} as const;

export const modelTypeOptions = requestTypeOptions;
export type ModelType = RequestType;
export const ModelType = RequestType;

export const billingUnitOptions = ["TOKENS", "SEARCHES"] as const;
export type BillingUnit = (typeof billingUnitOptions)[number];
export const BillingUnit = {
	Tokens: "TOKENS",
	Searches: "SEARCHES",
} as const;

export const costTokenTypeOptions = [
	"input",
	"cached",
	"cache_write",
	"output",
] as const;

export type CostTokenType = (typeof costTokenTypeOptions)[number];

function normalizeCostTokenTypeValue(value: string) {
	return value.trim().toLowerCase();
}

export function canonicalizeCostTokenType(value: string): CostTokenType | null {
	switch (normalizeCostTokenTypeValue(value)) {
		case "input":
		case "prompt":
		case "input_tokens":
		case "prompt_tokens":
		case "inp":
			return "input";
		case "cached":
		case "cache":
		case "cached_input":
		case "input_cached":
		case "cached_input_tokens":
		case "cached_input_token":
			return "cached";
		case "cache_write":
		case "cache-write":
		case "cachewrite":
			return "cache_write";
		case "output":
		case "completion":
		case "output_tokens":
		case "completion_tokens":
		case "outp":
			return "output";
		default:
			return null;
	}
}

export enum CostStageType {
	ContextLength = "context_length",
}

export const costStageTypeOptions = [CostStageType.ContextLength] as const;
