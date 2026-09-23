"use client";

import { Check, Copy, Server, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";

const modelsEndpoint = "https://api.example.com/api/v1/models";
const curlExample = `curl "${modelsEndpoint}" \\
  -H "Authorization: Bearer <API-KEY>"`;

function modelTypeLabel(modelType: string) {
	return modelType === "RERANK" ? "Reranking" : "Chat-Completions";
}

export default function ModelsPage() {
	const {
		data: models = [],
		isLoading,
		isError,
		refetch,
	} = api.models.list.useQuery();
	const [copied, setCopied] = useState<string | null>(null);

	async function copyToClipboard(value: string, key: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(key);
			window.setTimeout(() => setCopied(null), 1600);
			toast.success(`${label} kopiert.`);
		} catch {
			toast.error(
				"Kopieren nicht möglich. Bitte die Zwischenablage-Berechtigung prüfen.",
			);
		}
	}

	return (
		<div className="mx-auto w-full max-w-5xl px-6 py-10">
			<div className="space-y-2">
				<div className="flex items-center gap-2 text-muted-foreground">
					<Server className="size-4" />
					<span className="text-xs uppercase tracking-wide">API-Katalog</span>
				</div>
				<h1 className="font-semibold text-2xl">Verfügbare Modelle</h1>
				<p className="max-w-2xl text-muted-foreground text-sm">
					Entdecke die für die API konfigurierten Modelle. IDs lassen sich
					direkt kopieren und in API-Anfragen verwenden.
				</p>
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
				<Card>
					<CardHeader>
						<div className="flex items-start justify-between gap-4">
							<div className="space-y-1">
								<CardTitle>Modellkatalog</CardTitle>
								<CardDescription>
									{isLoading
										? "Konfigurierte Modelle werden geladen…"
										: `${models.length} ${models.length === 1 ? "Modell" : "Modelle"} verfügbar`}
								</CardDescription>
							</div>
							{isError ? (
								<Button
									onClick={() => void refetch()}
									size="sm"
									variant="outline"
								>
									Erneut laden
								</Button>
							) : null}
						</div>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<output aria-label="Modelle werden geladen" className="space-y-3">
								<div className="h-14 animate-pulse bg-muted" />
								<div className="h-14 animate-pulse bg-muted" />
							</output>
						) : isError ? (
							<p className="text-destructive text-sm" role="alert">
								Modelle konnten nicht geladen werden. Bitte versuche es erneut.
							</p>
						) : models.length === 0 ? (
							<p className="py-6 text-center text-muted-foreground text-sm">
								Aktuell sind keine Modelle konfiguriert.
							</p>
						) : (
							<ul className="divide-y divide-border">
								{models.map((model) => {
									const copyKey = `model:${model.id}`;
									const didCopy = copied === copyKey;
									return (
										<li
											className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
											key={model.id}
										>
											<div className="min-w-0 space-y-1">
												<p className="break-all font-mono text-sm">
													{model.id}
												</p>
												<span className="inline-flex rounded-sm bg-muted px-2 py-0.5 text-muted-foreground text-xs">
													{modelTypeLabel(model.modelType)}
												</span>
											</div>
											<Button
												aria-label={`${model.id} kopieren`}
												onClick={() =>
													void copyToClipboard(model.id, copyKey, "Modell-ID")
												}
												size="sm"
												variant="outline"
											>
												{didCopy ? <Check /> : <Copy />}
												<span>{didCopy ? "Kopiert" : "ID kopieren"}</span>
											</Button>
										</li>
									);
								})}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Terminal className="size-4" />
							Modelle per API abrufen
						</CardTitle>
						<CardDescription>
							Beispiel mit API-Key im Bearer-Header. Ersetze den Beispiel-Host
							und den Schlüssel durch deine Umgebung.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="overflow-x-auto rounded-sm bg-muted p-4">
							<pre className="font-mono text-xs leading-relaxed">
								<code>{curlExample}</code>
							</pre>
						</div>
						<Button
							onClick={() =>
								void copyToClipboard(curlExample, "curl", "Beispiel")
							}
							size="sm"
							variant="outline"
						>
							{copied === "curl" ? <Check /> : <Copy />}
							<span>{copied === "curl" ? "Kopiert" : "Beispiel kopieren"}</span>
						</Button>
						<p className="text-muted-foreground text-xs leading-relaxed">
							Die Antwort folgt dem OpenAI-Modelllistenformat mit Modell-IDs.
							Der hier angezeigte Typ (Chat-Completions oder Reranking) ist
							Konfigurationsinformation und kein Feld der API-Antwort.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
