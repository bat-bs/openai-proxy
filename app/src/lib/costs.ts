export const costUnitOptions = ["1M", "1K"] as const;

export type CostUnit = (typeof costUnitOptions)[number];

export enum CostStageType {
	ContextLength = "context_length",
}

export const costStageTypeOptions = [CostStageType.ContextLength] as const;
