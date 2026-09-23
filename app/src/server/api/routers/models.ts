import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { models } from "~/server/db/schema";

export const modelsRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({ id: models.id, modelType: models.modelType })
			.from(models)
			.orderBy(models.id);
	}),
});
