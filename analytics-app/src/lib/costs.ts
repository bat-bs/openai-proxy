export const costUnitOptions = ["1M", "1K"] as const;

export type CostUnit = (typeof costUnitOptions)[number];
