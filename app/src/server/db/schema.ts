import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	char,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";

export const atlasSchemaRevisions = pgTable("atlas_schema_revisions", {
	version: varchar().primaryKey().notNull(),
	description: varchar().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	type: bigint({ mode: "number" }).default(2).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	applied: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	total: bigint({ mode: "number" }).default(0).notNull(),
	executedAt: timestamp("executed_at", {
		withTimezone: true,
		mode: "string",
	}).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	executionTime: bigint("execution_time", { mode: "number" }).notNull(),
	error: text(),
	errorStmt: text("error_stmt"),
	hash: varchar().notNull(),
	partialHashes: jsonb("partial_hashes"),
	operatorVersion: varchar("operator_version").notNull(),
});

export const company = pgTable("company", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({
		name: "company_id_seq",
		startWith: 1,
		increment: 1,
		minValue: 1,
		// biome-ignore lint/correctness/noPrecisionLoss: matches Postgres BIGINT max.
		maxValue: 9223372036854775807,
		cache: 1,
	}),
	companyName: varchar("company_name", { length: 255 }).notNull(),
});

export const requestType = pgEnum("request_type", [
	"CHAT_COMPLETION",
	"RERANK",
]);
export const billingUnit = pgEnum("billing_unit", ["TOKENS", "SEARCHES"]);
export const modelType = pgEnum("model_type", ["CHAT_COMPLETION", "RERANK"]);

export const requests = pgTable(
	"requests",
	{
		id: varchar({ length: 255 }).primaryKey().notNull(),
		requestTime: timestamp("request_time", {
			withTimezone: true,
			mode: "string",
		}).defaultNow(),
		apiKeyId: varchar("api_key_id", { length: 255 }).notNull(),
		requestType: requestType("request_type").notNull(),
		inputTokenCount: integer("input_token_count"),
		cachedInputTokenCount: integer("cached_input_token_count"),
		outputTokenCount: integer("output_token_count"),
		searchUnits: integer("search_units"),
		model: varchar({ length: 255 }),
		snapshotVersion: varchar("snapshot_version", { length: 255 }),
		isApproximated: boolean("is_approximated").default(false).notNull(),
		cacheWriteTokenCount: integer("cache_write_token_count")
			.default(0)
			.notNull(),
	},
	(table) => [
		index("requests_request_time_idx").on(table.requestTime),
		index("requests_api_key_id_request_time_idx").on(
			table.apiKeyId,
			table.requestTime,
		),
		foreignKey({
			columns: [table.apiKeyId],
			foreignColumns: [apikeys.uuid],
			name: "requests_api_key_id_fkey",
		}),
	],
);

export const requestStatisticsCacheBuckets = pgTable(
	"request_statistics_cache_buckets",
	{
		bucketStart: timestamp("bucket_start", {
			withTimezone: true,
			mode: "string",
		}).primaryKey(),
		builtAt: timestamp("built_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
		invalidatedAt: timestamp("invalidated_at", {
			withTimezone: true,
			mode: "string",
		}),
	},
);

export const requestStatisticsCache = pgTable(
	"request_statistics_cache",
	{
		bucketStart: timestamp("bucket_start", {
			withTimezone: true,
			mode: "string",
		}).notNull(),
		apiKeyId: varchar("api_key_id", { length: 255 }).notNull(),
		// An empty string represents a request whose model is NULL. Keeping the
		// key non-null lets the aggregate use a regular composite primary key.
		model: varchar({ length: 255 }).notNull().default(""),
		requestType: requestType("request_type").notNull(),
		requestCount: bigint("request_count", { mode: "bigint" })
			.notNull()
			.default(0n),
		inputTokenCount: bigint("input_token_count", { mode: "bigint" })
			.notNull()
			.default(0n),
		cachedInputTokenCount: bigint("cached_input_token_count", {
			mode: "bigint",
		})
			.notNull()
			.default(0n),
		cacheWriteTokenCount: bigint("cache_write_token_count", { mode: "bigint" })
			.notNull()
			.default(0n),
		outputTokenCount: bigint("output_token_count", { mode: "bigint" })
			.notNull()
			.default(0n),
		searchUnits: bigint("search_units", { mode: "bigint" })
			.notNull()
			.default(0n),
		totalCostScaled: bigint("total_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		inputCostScaled: bigint("input_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		cachedCostScaled: bigint("cached_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		cacheWriteCostScaled: bigint("cache_write_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		outputCostScaled: bigint("output_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		searchCostScaled: bigint("search_cost_scaled", { mode: "bigint" })
			.notNull()
			.default(0n),
		currency: char({ length: 3 }),
		currencyTotals: jsonb("currency_totals")
			.$type<Record<string, string>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		missingCost: boolean("missing_cost").notNull().default(false),
		currencyIssue: boolean("currency_issue").notNull().default(false),
		usedCosts: jsonb("used_costs")
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
	},
	(table) => [
		primaryKey({
			columns: [
				table.bucketStart,
				table.apiKeyId,
				table.model,
				table.requestType,
			],
			name: "request_statistics_cache_pkey",
		}),
		foreignKey({
			columns: [table.bucketStart],
			foreignColumns: [requestStatisticsCacheBuckets.bucketStart],
			name: "request_statistics_cache_bucket_fkey",
		}),
		foreignKey({
			columns: [table.apiKeyId],
			foreignColumns: [apikeys.uuid],
			name: "request_statistics_cache_api_key_fkey",
		}),
		index("request_statistics_cache_bucket_idx").on(table.bucketStart),
		index("request_statistics_cache_api_key_bucket_idx").on(
			table.apiKeyId,
			table.bucketStart,
		),
	],
);

export const apikeys = pgTable(
	"apikeys",
	{
		uuid: varchar({ length: 255 }).primaryKey().notNull(),
		apikey: varchar({ length: 255 }).notNull(),
		owner: varchar({ length: 255 }).notNull(),
		description: varchar({ length: 255 }),
		deactivated: boolean("deactivated").default(false).notNull(),
	},
	(table) => [
		index("apikeys_owner_idx").on(table.owner),
		foreignKey({
			columns: [table.owner],
			foreignColumns: [users.id],
			name: "apikeys_owner_fkey",
		}),
	],
);

export const users = pgTable(
	"users",
	{
		id: varchar({ length: 255 }).primaryKey().notNull(),
		// You can use { mode: "bigint" } if numbers are exceeding js number limitations
		companyId: bigint("company_id", { mode: "number" }),
		name: varchar({ length: 255 }),
		isAdmin: boolean("is_admin"),
	},
	(table) => [
		foreignKey({
			columns: [table.companyId],
			foreignColumns: [company.id],
			name: "users_company_id_fkey",
		}),
	],
);

export const reportingGroups = pgTable(
	"reporting_groups",
	{
		id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({
			name: "reporting_groups_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			// biome-ignore lint/correctness/noPrecisionLoss: matches Postgres BIGINT max.
			maxValue: 9223372036854775807,
			cache: 1,
		}),
		title: varchar({ length: 255 }).notNull(),
		createdBy: varchar("created_by", { length: 255 }).notNull(),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "string",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "reporting_groups_created_by_fkey",
		}),
	],
);

export const reportingGroupMembers = pgTable(
	"reporting_group_members",
	{
		groupId: bigint("group_id", { mode: "number" }).notNull(),
		userId: varchar("user_id", { length: 255 }).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.groupId, table.userId],
			name: "reporting_group_members_pkey",
		}),
		foreignKey({
			columns: [table.groupId],
			foreignColumns: [reportingGroups.id],
			name: "reporting_group_members_group_id_fkey",
		}),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "reporting_group_members_user_id_fkey",
		}),
	],
);

export const reportingGroupViewers = pgTable(
	"reporting_group_viewers",
	{
		groupId: bigint("group_id", { mode: "number" }).notNull(),
		userId: varchar("user_id", { length: 255 }).notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.groupId, table.userId],
			name: "reporting_group_viewers_pkey",
		}),
		foreignKey({
			columns: [table.groupId],
			foreignColumns: [reportingGroups.id],
			name: "reporting_group_viewers_group_id_fkey",
		}),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "reporting_group_viewers_user_id_fkey",
		}),
	],
);

export const models = pgTable("models", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	modelType: modelType("model_type").notNull(),
});

export const costUnit = pgEnum("cost_unit", ["1M", "1K"]);

export const costs = pgTable(
	"costs",
	{
		id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({
			name: "costs_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			// biome-ignore lint/correctness/noPrecisionLoss: matches Postgres BIGINT max.
			maxValue: 9223372036854775807,
			cache: 1,
		}),
		model: varchar({ length: 255 }).notNull(),
		price: integer().notNull(),
		validFrom: date("valid_from").defaultNow().notNull(),
		requestType: requestType("request_type").notNull(),
		billingUnit: billingUnit("billing_unit").notNull(),
		tokenType: varchar("token_type", { length: 255 }),
		unitOfMessure: costUnit("unit_of_messure"),
		currency: char({ length: 3 }),
		stageType: text("stage_type").notNull().default("context_length"),
		stageMinTokens: integer("stage_min_tokens").notNull().default(0),
		stageMaxTokens: integer("stage_max_tokens"),
	},
	(table) => [
		uniqueIndex("costs_natural_key_idx").on(
			table.model,
			table.validFrom,
			table.requestType,
			table.billingUnit,
			sql`COALESCE(${table.tokenType}, '')`,
			table.unitOfMessure,
			table.currency,
			table.stageType,
			table.stageMinTokens,
			sql`COALESCE(${table.stageMaxTokens}, -1)`,
		),
	],
);

export const azurePricingConfig = pgTable("azure_pricing_config", {
	id: integer().primaryKey().default(1),
	serviceName: varchar("service_name", { length: 255 })
		.notNull()
		.default("Azure OpenAI"),
	armRegionName: varchar("arm_region_name", { length: 255 }).notNull(),
	currencyCode: char("currency_code", { length: 3 }).notNull(),
	productName: varchar("product_name", { length: 255 }),
	armSkuName: varchar("arm_sku_name", { length: 255 }),
	meterName: varchar("meter_name", { length: 255 }),
	priceType: varchar("price_type", { length: 32 })
		.notNull()
		.default("Consumption"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
});

export const azurePricingRules = pgTable("azure_pricing_rules", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	name: varchar({ length: 255 }).notNull(),
	enabled: boolean().notNull().default(true),
	priority: integer().notNull().default(0),
	action: varchar({ length: 16 }).notNull().default("map"),
	conditions: jsonb().notNull().default(sql`'[]'::jsonb`),
	assignments: jsonb().notNull().default(sql`'{}'::jsonb`),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
});

export const azurePricingAudits = pgTable("azure_pricing_audits", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	operation: varchar({ length: 16 }).notNull(),
	fetchedAuditId: bigint("fetched_audit_id", { mode: "number" }),
	outcome: varchar({ length: 32 }).notNull(),
	configuration: jsonb().notNull(),
	rawResponse: jsonb("raw_response").notNull(),
	counts: jsonb().notNull().default(sql`'{}'::jsonb`),
	rows: jsonb().notNull().default(sql`'[]'::jsonb`),
	error: text(),
});
