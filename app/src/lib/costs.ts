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

export enum CostStageType {
	ContextLength = "context_length",
}

export const costStageTypeOptions = [CostStageType.ContextLength] as const;
