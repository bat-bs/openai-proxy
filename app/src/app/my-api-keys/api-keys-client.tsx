"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
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
	const [showDeactivated, setShowDeactivated] = useState(false);
	const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
	const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
	const [confirmPayload, setConfirmPayload] = useState<{
		id: string;
		label: string;
	} | null>(null);

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

	const deactivateApiKey = api.apiKey.deactivateApiKey.useMutation({
		onSuccess: async () => {
			await utils.apiKey.getApiKeys.invalidate();
			toast.success("API-Key deaktiviert.");
		},
		onError: () => {
			toast.error("API-Key konnte nicht deaktiviert werden.");
		},
		onSettled: () => {
			setDeactivatingId(null);
		},
	});

	const visibleData = showDeactivated
		? data
		: data.filter((row) => !row.deactivated);

	return (
		<div className="space-y-6">
			{isLoading ? (
				<div className="text-muted-foreground text-sm">
					Schlüssel werden geladen...
				</div>
			) : (
				<ApiKeysTable
					action={
						<div className="flex flex-wrap items-center gap-3">
							<label className="flex items-center gap-2 text-sm">
								<input
									checked={showDeactivated}
									className="h-4 w-4 rounded border-border"
									onChange={(event) => setShowDeactivated(event.target.checked)}
									type="checkbox"
								/>
								<span>Deaktivierte anzeigen</span>
							</label>
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
								<DialogTrigger render={<Button />}>
									API-Key erstellen
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Neuer API-Key</DialogTitle>
										<DialogDescription>
											Füge optional eine Beschreibung hinzu und erstelle den
											Schlüssel.
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
													Dieser Schlüssel wird nur einmal angezeigt. Bitte
													jetzt sicher speichern.
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
					}
					data={visibleData.map((row) => ({
						kind: "key",
						id: row.id,
						description: row.description,
						deactivated: row.deactivated,
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
					deactivatingId={deactivatingId}
					onRequestDeactivate={({ id, label }) => {
						if (deactivateApiKey.isPending) return;
						setConfirmPayload({ id, label });
						setConfirmDialogOpen(true);
					}}
				/>
			)}
			<Dialog
				onOpenChange={(open) => {
					setConfirmDialogOpen(open);
					if (!open) {
						setConfirmPayload(null);
					}
				}}
				open={confirmDialogOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>API-Key deaktivieren?</DialogTitle>
						<DialogDescription>
							Möchtest du den API-Key{" "}
							<span className="font-medium">
								{confirmPayload?.label ?? "Ohne Beschreibung"}
							</span>{" "}
							deaktivieren?
							{confirmPayload?.id ? (
								<span className="mt-2 block text-muted-foreground">
									ID: {confirmPayload.id}
								</span>
							) : null}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Abbrechen
						</DialogClose>
						<Button
							onClick={() => {
								if (!confirmPayload || deactivateApiKey.isPending) return;
								setConfirmDialogOpen(false);
								setConfirmPayload(null);
								setDeactivatingId(confirmPayload.id);
								deactivateApiKey.mutate({ id: confirmPayload.id });
							}}
						>
							Deaktivieren
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
