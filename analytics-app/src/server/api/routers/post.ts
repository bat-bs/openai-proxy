import { z } from "zod";

import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";

export const postRouter = createTRPCRouter({
	hello: publicProcedure
		.input(z.object({ text: z.string() }))
		.query(({ input }) => {
			return {
				greeting: `Hello ${input.text}`,
			};
		}),

	getLatest: protectedProcedure.query(async ({ ctx }) => {
		const apiKey = await ctx.db.query.requests.findFirst({
			orderBy: (apiKey, { desc }) => [desc(apiKey.apiKeyId)],
		});

		return apiKey ?? null;
	}),

	getSecretMessage: protectedProcedure.query(() => {
		return "you can now see this secret message!";
	}),
});
