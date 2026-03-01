"use client";

import { useState } from "react";

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
import { toast } from "sonner";

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
			<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-4">
				<div>
					<h2 className="text-sm font-semibold">API-Key erstellen</h2>
					<p className="text-xs text-muted-foreground">
						Einen neuen Schlüssel für dein Konto erstellen.
					</p>
				</div>
				<Dialog
					open={dialogOpen}
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
				>
					<DialogTrigger render={<Button />}>API-Key erstellen</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Neuer API-Key</DialogTitle>
							<DialogDescription>
								Füge optional eine Beschreibung hinzu und erstelle den Schlüssel.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-3">
							<Input
								placeholder="Beschreibung (optional)"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
							/>
							{token ? (
								<div className="space-y-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
									<div className="text-xs font-semibold uppercase tracking-wide">
										Warnung
									</div>
									<p className="text-sm">
										Dieser Schlüssel wird nur einmal angezeigt. Bitte jetzt sicher speichern.
									</p>
									<div className="grid gap-2">
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
											Token kopieren
										</Button>
										{copied ? (
											<span className="text-xs text-muted-foreground">
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
									{createApiKey.isPending ? "Wird erstellt..." : "Schlüssel erstellen"}
								</Button>
								{createApiKey.error ? (
									<span className="text-xs text-destructive">
										Schlüssel konnte nicht erstellt werden. Bitte erneut versuchen.
									</span>
								) : null}
							</div>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
			{isLoading ? (
				<div className="text-sm text-muted-foreground">Schlüssel werden geladen...</div>
			) : (
				<ApiKeysTable data={data} />
			)}
		</div>
	);
}
