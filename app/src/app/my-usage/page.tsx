import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { ReportingCreateClient } from "../reporting/create/reporting-create-client";

export default async function MyUsagePage() {
	const session = await auth();
	if (!session?.user) redirect("/");

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl">Meine Nutzung</h1>
				<p className="text-muted-foreground text-sm">
					Eigene API-Nutzung und Kosten, ausschließlich für deine API-Schlüssel.
				</p>
			</div>
			<div className="mt-6">
				<ReportingCreateClient isAdmin={false} isSelf />
			</div>
		</div>
	);
}
