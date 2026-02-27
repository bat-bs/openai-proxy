import { ApiKeysTable } from "~/app/my-api-keys/api-keys-table"
import { api } from "~/trpc/server"

export default async function MyApiKeysPage() {
	const data = await api.apiKey.getApiKeys();

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">My API Keys</h1>
				<p className="text-sm text-muted-foreground">
					Track usage by key, filter results, and sort by token totals.
				</p>
			</div>
			<div className="mt-6">
				<ApiKeysTable data={data} />
			</div>
		</div>
	)
}
