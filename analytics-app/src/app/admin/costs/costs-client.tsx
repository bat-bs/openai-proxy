"use client";

import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import { CostsTable } from "./costs-table";

const defaultUnit = "1M";
const defaultBackend = "openai";
const defaultCurrency = "EUR";
const defaultTokenType = "input";

function todayString() {
	return new Date().toISOString().slice(0, 10);
}

export function CostsClient() {
	const utils = api.useUtils();
	const { data: costs = [], isLoading } = api.admin.listCosts.useQuery();
	const { data: models = [] } = api.admin.listModels.useQuery();

	const [model, setModel] = useState("");
	const [tokenType, setTokenType] = useState(defaultTokenType);
	const [price, setPrice] = useState("");
	const [validFrom, setValidFrom] = useState(todayString());
	const [unitOfMessure, setUnitOfMessure] = useState(defaultUnit);
	const [isRegional, setIsRegional] = useState(false);
	const [backendName, setBackendName] = useState(defaultBackend);
	const [currency, setCurrency] = useState(defaultCurrency);

	const createCost = api.admin.createCost.useMutation({
		onSuccess: async () => {
			setModel("");
			setTokenType(defaultTokenType);
			setPrice("");
			setValidFrom(todayString());
			setUnitOfMessure(defaultUnit);
			setIsRegional(false);
			setBackendName(defaultBackend);
			setCurrency(defaultCurrency);
			await utils.admin.listCosts.invalidate();
		},
	});

	const updateCost = api.admin.updateCost.useMutation({
		onSuccess: async () => {
			await utils.admin.listCosts.invalidate();
		},
	});

	const updatePricing = api.admin.updatePricing.useMutation({
		onSuccess: async () => {
			await utils.admin.listCosts.invalidate();
		},
	});

	const priceValue = useMemo(() => Number.parseInt(price, 10), [price]);
	const canSubmit =
		model.trim().length > 0 &&
		backendName.trim().length > 0 &&
		tokenType.trim().length > 0 &&
		!Number.isNaN(priceValue);

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold">Kostenverwaltung</h1>
				<p className="text-sm text-muted-foreground">
					Neue Preise anlegen oder bestehende Einträge aktualisieren.
				</p>
			</div>

			<div className="mt-6 space-y-6">
				<div className="rounded-lg border border-border bg-card p-6">
					<div className="flex flex-col gap-4">
						<div>
							<h2 className="text-sm font-semibold">Neuen Eintrag anlegen</h2>
							<p className="text-xs text-muted-foreground">
								Standardwerte: Backend {defaultBackend}, Einheit {defaultUnit}, Währung {defaultCurrency}.
							</p>
						</div>
						<div className="grid gap-3 md:grid-cols-3">
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Model</label>
								<Input
									list="costs-models"
									value={model}
									onChange={(event) => setModel(event.target.value)}
									placeholder="gpt-4.1"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Token type</label>
								<Input
									value={tokenType}
									onChange={(event) => setTokenType(event.target.value)}
									placeholder="input"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Preis</label>
								<Input
									type="number"
									value={price}
									onChange={(event) => setPrice(event.target.value)}
									placeholder="0"
									min={0}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Gültig ab</label>
								<Input
									type="date"
									value={validFrom}
									onChange={(event) => setValidFrom(event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Einheit</label>
								<Input
									value={unitOfMessure}
									onChange={(event) => setUnitOfMessure(event.target.value)}
									placeholder="1M"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Backend</label>
								<Input
									value={backendName}
									onChange={(event) => setBackendName(event.target.value)}
									placeholder="openai"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-muted-foreground">Währung</label>
								<Input
									value={currency}
									onChange={(event) => setCurrency(event.target.value.toUpperCase())}
									placeholder="EUR"
									maxLength={3}
								/>
							</div>
							<div className="flex items-center gap-2">
								<input
									id="isRegional"
									type="checkbox"
									checked={isRegional}
									onChange={(event) => setIsRegional(event.target.checked)}
									className="h-4 w-4 rounded border-border"
								/>
								<label htmlFor="isRegional" className="text-sm">
									Regional pricing
								</label>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<Button
								disabled={createCost.isPending || !canSubmit}
								onClick={() =>
									createCost.mutate({
										model: model.trim(),
										price: priceValue,
										validFrom: validFrom || undefined,
										tokenType: tokenType.trim(),
										unitOfMessure: unitOfMessure.trim() || null,
										isRegional,
										backendName: backendName.trim(),
										currency: currency.trim() || null,
									})
								}
							>
								{createCost.isPending ? "Speichern..." : "Eintrag erstellen"}
							</Button>
							{createCost.error ? (
								<span className="text-xs text-destructive">
									Speichern fehlgeschlagen.
								</span>
							) : null}
						</div>
					</div>
				</div>

				<CostsTable
					data={costs}
					isLoading={isLoading}
					onUpdateCost={(payload) => updateCost.mutate(payload)}
					onUpdatePricing={(payload) => updatePricing.mutate(payload)}
					isMutating={updateCost.isPending || updatePricing.isPending}
				/>
			</div>

			<datalist id="costs-models">
				{models.map((model) => (
					<option key={model} value={model} />
				))}
			</datalist>
		</div>
	);
}
