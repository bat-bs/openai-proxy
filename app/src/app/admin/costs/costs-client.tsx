"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "~/components/ui/native-select";
import { type CostUnit, costUnitOptions } from "~/lib/costs";
import { api } from "~/trpc/react";
import { CostsTable } from "./costs-table";

const defaultUnit = costUnitOptions[0];
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
	const [unitOfMessure, setUnitOfMessure] = useState<CostUnit>(defaultUnit);
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
			toast.success("Eintrag erstellt.");
		},
		onError: () => {
			toast.error("Eintrag konnte nicht erstellt werden.");
		},
	});

	const updateCost = api.admin.updateCost.useMutation({
		onSuccess: async () => {
			await utils.admin.listCosts.invalidate();
			toast.success("Eintrag aktualisiert.");
		},
		onError: () => {
			toast.error("Eintrag konnte nicht aktualisiert werden.");
		},
	});

	const updatePricing = api.admin.updatePricing.useMutation({
		onSuccess: async () => {
			await utils.admin.listCosts.invalidate();
			toast.success("Preise aktualisiert.");
		},
		onError: () => {
			toast.error("Preise konnten nicht aktualisiert werden.");
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
				<h1 className="font-semibold text-2xl">Kostenverwaltung</h1>
				<p className="text-muted-foreground text-sm">
					Neue Preise anlegen oder bestehende Einträge aktualisieren.
				</p>
			</div>

			<div className="mt-6 space-y-6">
				<div className="rounded-lg border border-border bg-card p-6">
					<div className="flex flex-col gap-4">
						<div>
							<h2 className="font-semibold text-sm">Neuen Eintrag anlegen</h2>
							<p className="text-muted-foreground text-xs">
								Standardwerte: Backend {defaultBackend}, Einheit {defaultUnit},
								Währung {defaultCurrency}.
							</p>
						</div>
						<div className="grid gap-3 md:grid-cols-3">
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-model"
								>
									Modell
								</label>
								<Input
									id="costs-create-model"
									list="costs-models"
									onChange={(event) => setModel(event.target.value)}
									placeholder="gpt-4.1"
									value={model}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-token-type"
								>
									Token-Typ
								</label>
								<Input
									id="costs-create-token-type"
									onChange={(event) => setTokenType(event.target.value)}
									placeholder="input"
									value={tokenType}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-price"
								>
									Preis
								</label>
								<Input
									id="costs-create-price"
									min={0}
									onChange={(event) => setPrice(event.target.value)}
									placeholder="0"
									type="number"
									value={price}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-valid-from"
								>
									Gültig ab
								</label>
								<Input
									id="costs-create-valid-from"
									onChange={(event) => setValidFrom(event.target.value)}
									type="date"
									value={validFrom}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-unit"
								>
									Einheit
								</label>
								<NativeSelect
									className="w-full"
									id="costs-create-unit"
									onChange={(event) =>
										setUnitOfMessure(event.target.value as CostUnit)
									}
									value={unitOfMessure}
								>
									{costUnitOptions.map((unit) => (
										<NativeSelectOption key={unit} value={unit}>
											{unit}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-backend"
								>
									Backend
								</label>
								<Input
									id="costs-create-backend"
									onChange={(event) => setBackendName(event.target.value)}
									placeholder="openai"
									value={backendName}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-currency"
								>
									Währung
								</label>
								<Input
									id="costs-create-currency"
									maxLength={3}
									onChange={(event) =>
										setCurrency(event.target.value.toUpperCase())
									}
									placeholder="EUR"
									value={currency}
								/>
							</div>
							<div className="flex items-center gap-2">
								<input
									checked={isRegional}
									className="h-4 w-4 rounded border-border"
									id="isRegional"
									onChange={(event) => setIsRegional(event.target.checked)}
									type="checkbox"
								/>
								<label className="text-sm" htmlFor="isRegional">
									Regionale Preisgestaltung
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
										unitOfMessure: unitOfMessure ?? null,
										isRegional,
										backendName: backendName.trim(),
										currency: currency.trim() || null,
									})
								}
							>
								{createCost.isPending ? "Speichern..." : "Eintrag erstellen"}
							</Button>
							{createCost.error ? (
								<span className="text-destructive text-xs">
									Speichern fehlgeschlagen.
								</span>
							) : null}
						</div>
					</div>
				</div>

				<CostsTable
					data={costs}
					isLoading={isLoading}
					isMutating={updateCost.isPending || updatePricing.isPending}
					onUpdateCost={(payload) => updateCost.mutate(payload)}
					onUpdatePricing={(payload) => updatePricing.mutate(payload)}
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
