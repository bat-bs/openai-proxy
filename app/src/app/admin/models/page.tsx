import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { ModelsClient } from "./models-client";

export default async function AdminModelsPage() {
	const session = await auth();
	if (!session?.user?.isAdmin) {
		redirect("/");
	}

	return <ModelsClient />;
}
