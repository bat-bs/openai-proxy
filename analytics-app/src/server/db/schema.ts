import { pgTable, varchar, bigint, timestamp, text, jsonb, foreignKey, integer, boolean, primaryKey, date, char, pgEnum } from "drizzle-orm/pg-core"

export const atlasSchemaRevisions = pgTable("atlas_schema_revisions", {
	version: varchar().primaryKey().notNull(),
	description: varchar().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	type: bigint({ mode: "number" }).default(2).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	applied: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	total: bigint({ mode: "number" }).default(0).notNull(),
	executedAt: timestamp("executed_at", { withTimezone: true, mode: 'string' }).notNull(),
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
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "company_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	companyName: varchar("company_name", { length: 255 }).notNull(),
});

export const requests = pgTable("requests", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	requestTime: timestamp("request_time", { withTimezone: true, mode: 'string' }).defaultNow(),
	model: varchar({ length: 255 }),
	apiKeyId: varchar("api_key_id", { length: 255 }).notNull(),
	inputTokenCount: integer("input_token_count").default(0).notNull(),
	cachedInputTokenCount: integer("cached_input_token_count").default(0).notNull(),
	outputTokenCount: integer("output_token_count").default(0).notNull(),
	snapshotVersion: varchar("snapshot_version", { length: 255 }),
	isApproximated: boolean("is_approximated").default(false).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.apiKeyId],
		foreignColumns: [apikeys.uuid],
		name: "requests_api_key_id_fkey"
	}),
]);

export const apikeys = pgTable("apikeys", {
	uuid: varchar({ length: 255 }).primaryKey().notNull(),
	apikey: varchar({ length: 255 }).notNull(),
	owner: varchar({ length: 255 }).notNull(),
	aiapi: varchar({ length: 255 }),
	description: varchar({ length: 255 }),
}, (table) => [
	foreignKey({
		columns: [table.owner],
		foreignColumns: [users.id],
		name: "apikeys_owner_fkey"
	}),
]);

export const users = pgTable("users", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	companyId: bigint("company_id", { mode: "number" }),
	name: varchar({ length: 255 }),
	isAdmin: boolean("is_admin"),
}, (table) => [
	foreignKey({
		columns: [table.companyId],
		foreignColumns: [company.id],
		name: "users_company_id_fkey"
	}),
]);

export const models = pgTable("models", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
});

export const costUnit = pgEnum("cost_unit", ["1M", "1K"]);

export const costs = pgTable("costs", {
	model: varchar({ length: 255 }).notNull(),
	price: integer().notNull(),
	validFrom: date("valid_from").defaultNow().notNull(),
	tokenType: varchar("token_type", { length: 255 }).notNull(),
	unitOfMessure: costUnit("unit_of_messure"),
	isRegional: boolean("is_regional").notNull(),
	backendName: varchar("backend_name", { length: 255 }).notNull(),
	currency: char({ length: 3 }),
}, (table) => [
	primaryKey({ columns: [table.model, table.price, table.validFrom, table.tokenType, table.isRegional, table.backendName], name: "costs_pkey"}),
]);
