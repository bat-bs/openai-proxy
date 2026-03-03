import { ApiKeysClient } from "~/app/my-api-keys/api-keys-client";

export default async function MyApiKeysPage() {
	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl">Meine API-Keys</h1>
				<p className="text-muted-foreground text-sm">
					Nutzung nach Schlüssel verfolgen, Ergebnisse filtern und nach
					Token-Summen sortieren.
				</p>
			</div>
			<div className="mt-6">
				<ApiKeysClient />
			</div>
		</div>
	);
}
