"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { api } from "~/trpc/react";

export function ModelsClient() {
	const utils = api.useUtils();
	const { data: models = [], isLoading } = api.admin.listModels.useQuery();
	const [modelId, setModelId] = useState("");

	const addModel = api.admin.addModel.useMutation({
		onSuccess: async () => {
			setModelId("");
			await utils.admin.listModels.invalidate();
			toast.success("Modell hinzugefügt.");
		},
		onError: () => {
			toast.error("Modell konnte nicht hinzugefügt werden.");
		},
	});

	const deleteModel = api.admin.deleteModel.useMutation({
		onSuccess: async () => {
			await utils.admin.listModels.invalidate();
			toast.success("Modell entfernt.");
		},
		onError: () => {
			toast.error("Modell konnte nicht entfernt werden.");
		},
	});

	const trimmedModelId = useMemo(() => modelId.trim(), [modelId]);
	const canSubmit = trimmedModelId.length > 0;
	const isMutating = addModel.isPending || deleteModel.isPending;

	return (
		<div className="mx-auto w-full max-w-4xl px-6 py-10">
			<div className="flex flex-col gap-2">
				<h1 className="font-semibold text-2xl">Modelle</h1>
				<p className="text-muted-foreground text-sm">
					Verfügbare Modelle verwalten und nicht mehr benötigte Einträge
					entfernen.
				</p>
			</div>

			<div className="mt-6 space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>Modell hinzufügen</CardTitle>
						<CardDescription>
							Ein Modell wird direkt zur Konfiguration hinzugefügt.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="flex flex-col gap-3 sm:flex-row"
							onSubmit={(event) => {
								event.preventDefault();
								if (!canSubmit) return;
								addModel.mutate({ modelId: trimmedModelId });
							}}
						>
							<Input
								aria-label="Modell-ID"
								disabled={isMutating}
								onChange={(event) => setModelId(event.target.value)}
								placeholder="gpt-4.1"
								value={modelId}
							/>
							<Button disabled={isMutating || !canSubmit} type="submit">
								<Plus />
								<span>Hinzufügen</span>
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Konfigurierte Modelle</CardTitle>
						<CardDescription>
							{models.length} Einträge in der Liste.
						</CardDescription>
					</CardHeader>
					<Separator />
					<CardContent className="pt-4">
						{isLoading ? (
							<p className="text-muted-foreground text-sm">Lade Modelle...</p>
						) : models.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Keine Modelle konfiguriert.
							</p>
						) : (
							<div className="flex flex-wrap gap-2">
								{models.map((model) => (
									<span
										className="inline-flex items-center gap-2 rounded-none border border-border bg-muted px-3 py-1.5 text-sm"
										key={model}
									>
										<span className="max-w-[16rem] truncate">{model}</span>
										<Button
											aria-label={`Modell ${model} entfernen`}
											disabled={isMutating}
											onClick={() => deleteModel.mutate({ modelId: model })}
											size="icon-xs"
											variant="ghost"
										>
											<X />
										</Button>
									</span>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
