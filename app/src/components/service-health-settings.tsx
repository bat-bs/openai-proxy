"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

export function ServiceHealthSettings({ value }: { value: string }) {
	const [retention, setRetention] = useState(value);
	const utils = api.useUtils();
	const update = api.serviceHealth.updateSettings.useMutation({
		onSuccess: async (result) => {
			setRetention(result.value);
			await utils.serviceHealth.getSettings.invalidate();
			toast.success(`${result.deleted} alte Health-Metriken gelöscht.`);
		},
	});

	return (
		<main className="mx-auto w-full max-w-3xl px-6 py-10">
			<h1 className="font-semibold text-2xl">Health-Aufbewahrung</h1>
			<p className="mt-2 text-muted-foreground text-sm">
				Lege fest, wie lange Request-Health-Metriken gespeichert werden.
			</p>
			<Card className="mt-6">
				<CardHeader>
					<CardTitle>Aufbewahrungsdauer</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-end gap-3">
						<label className="grid gap-1 text-sm" htmlFor="health-retention">
							Dauer
							<Input
								id="health-retention"
								maxLength={32}
								onChange={(event) => setRetention(event.target.value)}
								placeholder="30d"
								value={retention}
							/>
						</label>
						<Button
							disabled={update.isPending}
							onClick={() => update.mutate({ value: retention })}
						>
							{update.isPending ? "Speichern…" : "Speichern"}
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						Erlaubt sind positive Werte mit <code>m</code> (Minuten),{" "}
						<code>h</code> (Stunden) oder <code>d</code> (Tage), zum Beispiel{" "}
						<code>30d</code>; maximal 10 Jahre.
					</p>
					{update.error ? (
						<p className="text-destructive text-sm">{update.error.message}</p>
					) : null}
				</CardContent>
			</Card>
		</main>
	);
}
