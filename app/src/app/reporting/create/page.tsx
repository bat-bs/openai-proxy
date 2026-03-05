import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { ReportingCreateClient } from "./reporting-create-client";

export default async function ReportingCreatePage() {
	const session = await auth();
	if (!session?.user) {
		redirect("/");
	}

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl">Bericht erstellen</h1>
				<p className="text-muted-foreground text-sm">
					Auswertung nach Gruppe und Zeitraum inklusive Kostenübersicht.
				</p>
			</div>
			<div className="mt-6">
				<ReportingCreateClient isAdmin={session.user.isAdmin ?? false} />
			</div>
		</div>
	);
}
