"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "~/components/ui/native-select";
import {
	BillingUnit,
	billingUnitOptions,
	CostStageType,
	type CostUnit,
	costStageTypeOptions,
	costUnitOptions,
	RequestType,
	requestTypeOptions,
} from "~/lib/costs";
import { api } from "~/trpc/react";
import { CostsTable } from "./costs-table";

const defaultUnit = costUnitOptions[0];
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
	const [requestType, setRequestType] = useState<RequestType>(
		RequestType.ChatCompletion,
	);
	const [billingUnit, setBillingUnit] = useState<BillingUnit>(
		BillingUnit.Tokens,
	);
	const [price, setPrice] = useState("");
	const [validFrom, setValidFrom] = useState(todayString());
	const [unitOfMessure, setUnitOfMessure] = useState<CostUnit>(defaultUnit);
	const [currency, setCurrency] = useState(defaultCurrency);
	const [stageType, setStageType] = useState<CostStageType>(
		CostStageType.ContextLength,
	);
	const [stageMinTokens, setStageMinTokens] = useState(0);
	const [stageMaxTokens, setStageMaxTokens] = useState<string>("");

	const createCost = api.admin.createCost.useMutation({
		onSuccess: async () => {
			setModel("");
			setTokenType(defaultTokenType);
			setRequestType(RequestType.ChatCompletion);
			setBillingUnit(BillingUnit.Tokens);
			setPrice("");
			setValidFrom(todayString());
			setUnitOfMessure(defaultUnit);
			setCurrency(defaultCurrency);
			setStageType(CostStageType.ContextLength);
			setStageMinTokens(0);
			setStageMaxTokens("");
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
	const stageMaxTokensValue =
		stageMaxTokens.trim() === "" ? null : Number.parseInt(stageMaxTokens, 10);
	const stageMaxTokensValid =
		stageMaxTokensValue === null || !Number.isNaN(stageMaxTokensValue);
	const canSubmit =
		model.trim().length > 0 &&
		(requestType === RequestType.Rerank || tokenType.trim().length > 0) &&
		!Number.isNaN(priceValue) &&
		stageMaxTokensValid;

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
								Standardwerte: Einheit {defaultUnit}, Währung {defaultCurrency}.
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
							{requestType === RequestType.Rerank ? (
								<div className="flex flex-col gap-1">
									<span className="font-medium text-muted-foreground text-xs">
										Token-Typ
									</span>
									<span className="text-muted-foreground text-sm">
										Nicht anwendbar
									</span>
								</div>
							) : (
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
							)}
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
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-request-type"
								>
									Request-Typ
								</label>
								<NativeSelect
									id="costs-create-request-type"
									onChange={(event) => {
										const nextType = event.target.value as RequestType;
										setRequestType(nextType);
										setBillingUnit(
											nextType === RequestType.Rerank
												? BillingUnit.Searches
												: BillingUnit.Tokens,
										);
										if (nextType === RequestType.Rerank) setTokenType("");
									}}
									value={requestType}
								>
									{requestTypeOptions.map((value) => (
										<NativeSelectOption key={value} value={value}>
											{value}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</div>
							<div className="flex flex-col gap-1">
								<label
									className="font-medium text-muted-foreground text-xs"
									htmlFor="costs-create-billing-unit"
								>
									Abrechnungseinheit
								</label>
								<NativeSelect
									id="costs-create-billing-unit"
									onChange={(event) => {
										const nextUnit = event.target.value as BillingUnit;
										setBillingUnit(nextUnit);
										setRequestType(
											nextUnit === BillingUnit.Searches
												? RequestType.Rerank
												: RequestType.ChatCompletion,
										);
										if (nextUnit === BillingUnit.Searches) setTokenType("");
									}}
									value={billingUnit}
								>
									{billingUnitOptions.map((value) => (
										<NativeSelectOption key={value} value={value}>
											{value}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</div>
						</div>

						{requestType !== RequestType.Rerank ? (
							<div className="mt-4 grid gap-3 md:grid-cols-3">
								<div className="flex flex-col gap-1">
									<label
										className="font-medium text-muted-foreground text-xs"
										htmlFor="costs-create-stage-type"
									>
										Stage Typ
									</label>
									<NativeSelect
										className="w-full"
										id="costs-create-stage-type"
										onChange={(event) =>
											setStageType(event.target.value as CostStageType)
										}
										value={stageType}
									>
										{costStageTypeOptions.map((stage) => (
											<NativeSelectOption key={stage} value={stage}>
												{stage}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</div>
								<div className="flex flex-col gap-1">
									<label
										className="font-medium text-muted-foreground text-xs"
										htmlFor="costs-create-stage-min"
									>
										Stage Min Tokens
									</label>
									<Input
										id="costs-create-stage-min"
										min={0}
										onChange={(event) =>
											setStageMinTokens(
												Number.parseInt(event.target.value || "0", 10),
											)
										}
										type="number"
										value={String(stageMinTokens)}
									/>
								</div>
								<div className="flex flex-col gap-1">
									<label
										className="font-medium text-muted-foreground text-xs"
										htmlFor="costs-create-stage-max"
									>
										Stage Max Tokens
									</label>
									<Input
										id="costs-create-stage-max"
										min={0}
										onChange={(event) => setStageMaxTokens(event.target.value)}
										placeholder="(optional)"
										type="number"
										value={stageMaxTokens}
									/>
								</div>
							</div>
						) : null}
						<div className="flex flex-wrap items-center gap-3">
							<Button
								disabled={createCost.isPending || !canSubmit}
								onClick={() =>
									createCost.mutate({
										model: model.trim(),
										price: priceValue,
										validFrom: validFrom || undefined,
										requestType,
										billingUnit,
										tokenType:
											requestType === RequestType.Rerank
												? null
												: tokenType.trim(),
										unitOfMessure: unitOfMessure ?? null,
										currency: currency.trim() || null,
										stageType:
											requestType === RequestType.Rerank
												? CostStageType.ContextLength
												: stageType,
										stageMinTokens:
											requestType === RequestType.Rerank ? 0 : stageMinTokens,
										stageMaxTokens:
											requestType === RequestType.Rerank
												? null
												: stageMaxTokensValue,
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
					<option key={model.id} value={model.id} />
				))}
			</datalist>
		</div>
	);
}
