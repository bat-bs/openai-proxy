import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { ReportingGroupsClient } from "./reporting-groups-client";

export default async function ReportingGroupsPage() {
	const session = await auth();
	if (!session?.user?.isAdmin) {
		redirect("/");
	}

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl">Abrechnungsgruppen</h1>
				<p className="text-muted-foreground text-sm">
					Gruppen erstellen, Benutzer zuweisen und Sichtbarkeiten steuern.
				</p>
			</div>
			<div className="mt-6">
				<ReportingGroupsClient />
			</div>
		</div>
	);
}
