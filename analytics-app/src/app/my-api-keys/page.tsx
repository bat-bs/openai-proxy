import { ApiKeysClient } from "~/app/my-api-keys/api-keys-client"

export default async function MyApiKeysPage() {
	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">My API Keys</h1>
				<p className="text-sm text-muted-foreground">
					Track usage by key, filter results, and sort by token totals.
				</p>
			</div>
			<div className="mt-6">
				<ApiKeysClient />
			</div>
		</div>
	)
}
