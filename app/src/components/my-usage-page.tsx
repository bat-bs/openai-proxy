import { ReportingCreateClient } from "~/app/reporting/create/reporting-create-client";

export function UsagePage() {
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
