"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import { ApiKeysTable } from "./api-keys-table";

export function ApiKeysClient() {
	const utils = api.useUtils();
	const { data = [], isLoading } = api.apiKey.getApiKeys.useQuery();
	const [description, setDescription] = useState("");
	const [token, setToken] = useState<string | null>(null);
	const [createdId, setCreatedId] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);

	const createApiKey = api.apiKey.createApiKey.useMutation({
		onSuccess: async (result) => {
			setToken(result.token);
			setCreatedId(result.id);
			setDescription("");
			setCopied(false);
			await utils.apiKey.getApiKeys.invalidate();
			toast.success("API-Key erstellt.");
		},
		onError: () => {
			toast.error("API-Key konnte nicht erstellt werden.");
		},
	});

	return (
		<div className="space-y-6">
			<Dialog
				onOpenChange={(open) => {
					setDialogOpen(open);
					if (!open) {
						setToken(null);
						setCreatedId(null);
						setDescription("");
						setCopied(false);
						createApiKey.reset();
					}
				}}
				open={dialogOpen}
			>
				{isLoading ? (
					<div className="text-muted-foreground text-sm">
						Schlüssel werden geladen...
					</div>
				) : (
					<ApiKeysTable
						action={
							<DialogTrigger render={<Button />}>
								API-Key erstellen
							</DialogTrigger>
						}
						data={data.map((row) => ({
							kind: "key",
							id: row.id,
							description: row.description,
							inputTokens: row.inputTokens,
							cachedInputTokens: row.cachedInputTokens,
							outputTokens: row.outputTokens,
							createdAt: row.createdAt,
							cost: row.cost ?? null,
							currency: row.currency ?? null,
							subRows: row.models.map((modelRow) => ({
								kind: "model",
								model: modelRow.model,
								inputTokens: modelRow.inputTokens,
								cachedInputTokens: modelRow.cachedInputTokens,
								outputTokens: modelRow.outputTokens,
								cost: modelRow.cost ?? null,
								currency: modelRow.currency ?? null,
							})),
						}))}
					/>
				)}
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Neuer API-Key</DialogTitle>
						<DialogDescription>
							Füge optional eine Beschreibung hinzu und erstelle den Schlüssel.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3">
						<Input
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Beschreibung (optional)"
							value={description}
						/>
						{token ? (
							<div className="space-y-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
								<div className="font-semibold text-xs uppercase tracking-wide">
									Warnung
								</div>
								<p className="text-sm">
									Dieser Schlüssel wird nur einmal angezeigt. Bitte jetzt sicher
									speichern.
								</p>
								<div className="grid gap-2">
									<Input readOnly value={token} />
									{createdId ? (
										<span className="self-center text-muted-foreground text-xs">
											ID: {createdId}
										</span>
									) : null}
								</div>
								<div className="flex items-center gap-2">
									<Button
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(token);
												setCopied(true);
												setTimeout(() => setCopied(false), 1500);
											} catch {
												setCopied(false);
											}
										}}
										size="sm"
										type="button"
										variant="outline"
									>
										Token kopieren
									</Button>
									{copied ? (
										<span className="text-muted-foreground text-xs">
											Kopiert.
										</span>
									) : null}
								</div>
							</div>
						) : null}
					</div>
					<DialogFooter showCloseButton>
						<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
							<Button
								disabled={createApiKey.isPending}
								onClick={() =>
									createApiKey.mutate({
										description: description.trim() || undefined,
									})
								}
							>
								{createApiKey.isPending
									? "Wird erstellt..."
									: "Schlüssel erstellen"}
							</Button>
							{createApiKey.error ? (
								<span className="text-destructive text-xs">
									Schlüssel konnte nicht erstellt werden. Bitte erneut
									versuchen.
								</span>
							) : null}
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
