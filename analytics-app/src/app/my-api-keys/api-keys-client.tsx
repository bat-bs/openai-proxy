"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import { ApiKeysTable } from "./api-keys-table";

export function ApiKeysClient() {
	const utils = api.useUtils();
	const { data = [], isLoading } = api.apiKey.getApiKeys.useQuery();
	const [description, setDescription] = useState("");
	const [aiapi, setAiapi] = useState("openai");
	const [token, setToken] = useState<string | null>(null);
	const [createdId, setCreatedId] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const createApiKey = api.apiKey.createApiKey.useMutation({
		onSuccess: async (result) => {
			setToken(result.token);
			setCreatedId(result.id);
			setDescription("");
			setCopied(false);
			await utils.apiKey.getApiKeys.invalidate();
		},
	});

	return (
		<div className="space-y-6">
			<div className="space-y-3 rounded-lg border border-border p-4">
				<div>
					<h2 className="text-sm font-semibold">Create API key</h2>
					<p className="text-xs text-muted-foreground">
						Generate a new key for the selected API type.
					</p>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<Input
						placeholder="API type (openai or azure)"
						value={aiapi}
						onChange={(event) => setAiapi(event.target.value)}
					/>
					<Input
						placeholder="Description (optional)"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						disabled={createApiKey.isPending || !aiapi.trim()}
						onClick={() =>
							createApiKey.mutate({
								aiapi: aiapi.trim(),
								description: description.trim() || undefined,
							})
						}
					>
						{createApiKey.isPending ? "Creating..." : "Create key"}
					</Button>
					{createApiKey.error ? (
						<span className="text-xs text-destructive">
							Failed to create key. Try again.
						</span>
					) : null}
				</div>
				{token ? (
					<div className="space-y-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
						<div className="text-xs font-semibold uppercase tracking-wide">
							Warning
						</div>
						<p className="text-sm">
							This key will only be shown once. Store it securely now.
						</p>
						<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
							<Input readOnly value={token} />
							{createdId ? (
								<span className="self-center text-xs text-muted-foreground">
									ID: {createdId}
								</span>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(token);
										setCopied(true);
										setTimeout(() => setCopied(false), 1500);
									} catch {
										setCopied(false);
									}
								}}
							>
								Copy token
							</Button>
							{copied ? (
								<span className="text-xs text-muted-foreground">Copied.</span>
							) : null}
						</div>
					</div>
				) : null}
			</div>
			{isLoading ? (
				<div className="text-sm text-muted-foreground">Loading keys...</div>
			) : (
				<ApiKeysTable data={data} />
			)}
		</div>
	);
}
