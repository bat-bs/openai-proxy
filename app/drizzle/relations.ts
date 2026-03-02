import { relations } from "drizzle-orm/relations";
import { apikeys, requests, users, company } from "./schema";

export const requestsRelations = relations(requests, ({one}) => ({
	apikey: one(apikeys, {
		fields: [requests.apiKeyId],
		references: [apikeys.uuid]
	}),
}));

export const apikeysRelations = relations(apikeys, ({one, many}) => ({
	requests: many(requests),
	user: one(users, {
		fields: [apikeys.owner],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	apikeys: many(apikeys),
	company: one(company, {
		fields: [users.companyId],
		references: [company.id]
	}),
}));

export const companyRelations = relations(company, ({many}) => ({
	users: many(users),
}));