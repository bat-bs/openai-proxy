"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import {
	NativeSelect,
	NativeSelectOption,
} from "~/components/ui/native-select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import {
	type BillingUnit,
	billingUnitOptions,
	CostStageType,
	type CostUnit,
	costStageTypeOptions,
	costUnitOptions,
	type RequestType,
	requestTypeOptions,
} from "~/lib/costs";

export type CostRow = {
	id: number;
	model: string;
	price: number;
	validFrom: string | null;
	tokenType: string | null;
	requestType: RequestType;
	billingUnit: BillingUnit;
	unitOfMessure: CostUnit | null;
	currency: string | null;
	stageType: CostStageType | null;
	stageMinTokens: number;
	stageMaxTokens: number | null;
};

type CostPayload = {
	id?: number;
	model: string;
	price: number;
	validFrom?: string;
	tokenType?: string | null;
	requestType: RequestType;
	billingUnit: BillingUnit;
	unitOfMessure?: CostUnit | null;
	currency?: string | null;
	stageType?: CostStageType | null;
	stageMinTokens?: number;
	stageMaxTokens?: number | null;
};

type CostUpdatePayload = {
	original: CostPayload;
	update: CostPayload;
};

type CostPricingPayload = {
	update: CostPayload;
};

const numberFormatter = new Intl.NumberFormat("de-DE");
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
	year: "numeric",
	month: "short",
	day: "2-digit",
});
const defaultUnit = costUnitOptions[0];

function formatDate(value: string | null) {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateFormatter.format(date);
}

function formatNumber(value: number) {
	return numberFormatter.format(value ?? 0);
}

function todayString() {
	return new Date().toISOString().slice(0, 10);
}

function CostEditDialog({
	row,
	onUpdateCost,
	onUpdatePricing,
	disabled,
}: {
	row: CostRow;
	onUpdateCost: (payload: CostUpdatePayload) => void;
	onUpdatePricing: (payload: CostPricingPayload) => void;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"update" | "modify">("update");
	const [model, setModel] = useState(row.model);
	const [tokenType, setTokenType] = useState(row.tokenType ?? "");
	const [requestType, setRequestType] = useState<RequestType>(row.requestType);
	const [billingUnit, setBillingUnit] = useState<BillingUnit>(row.billingUnit);
	const [price, setPrice] = useState(String(row.price));
	const [validFrom, setValidFrom] = useState(row.validFrom ?? todayString());
	const [stageType, setStageType] = useState<CostStageType>(
		row.stageType ?? CostStageType.ContextLength,
	);
	const [stageMinTokens, setStageMinTokens] = useState(row.stageMinTokens);
	const [stageMaxTokens, setStageMaxTokens] = useState(
		row.stageMaxTokens === null ? "" : String(row.stageMaxTokens),
	);
	const [unitOfMessure, setUnitOfMessure] = useState<CostUnit>(
		costUnitOptions.includes((row.unitOfMessure ?? "") as CostUnit)
			? ((row.unitOfMessure ?? defaultUnit) as CostUnit)
			: defaultUnit,
	);
	const [currency, setCurrency] = useState(row.currency ?? "");
	const fieldKey = String(row.id);

	const priceValue = useMemo(() => Number.parseInt(price, 10), [price]);
	const stageMaxTokensValue =
		stageMaxTokens.trim() === "" ? null : Number.parseInt(stageMaxTokens, 10);
	const stageMaxTokensValid =
		stageMaxTokensValue === null || !Number.isNaN(stageMaxTokensValue);
	const canSubmit =
		model.trim().length > 0 &&
		(requestType === "RERANK" || tokenType.trim().length > 0) &&
		!Number.isNaN(priceValue) &&
		stageMaxTokensValid &&
		stageMinTokens >= 0;

	const originalPayload = useMemo<CostPayload>(
		() => ({
			id: row.id,
			model: row.model,
			price: row.price,
			validFrom: row.validFrom ?? undefined,
			tokenType: row.tokenType ?? null,
			requestType: row.requestType,
			billingUnit: row.billingUnit,
			unitOfMessure: row.unitOfMessure ?? null,
			currency: row.currency ?? null,
			stageType: row.stageType ?? CostStageType.ContextLength,
			stageMinTokens: row.stageMinTokens,
			stageMaxTokens: row.stageMaxTokens ?? null,
		}),
		[row],
	);

	const today = useMemo(() => todayString(), []);
	const effectiveValidFrom = mode === "update" ? today : validFrom;

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) {
					setMode("update");
					setModel(row.model);
					setTokenType(row.tokenType ?? "");
					setRequestType(row.requestType);
					setBillingUnit(row.billingUnit);
					setPrice(String(row.price));
					setValidFrom(row.validFrom ?? todayString());
					setStageType(row.stageType ?? CostStageType.ContextLength);
					setStageMinTokens(row.stageMinTokens);
					setStageMaxTokens(
						row.stageMaxTokens === null ? "" : String(row.stageMaxTokens),
					);
					setUnitOfMessure(row.unitOfMessure ?? defaultUnit);
					setCurrency(row.currency ?? "");
				}
			}}
			open={open}
		>
			<DialogTrigger render={<Button size="sm" variant="outline" />}>
				Bearbeiten
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Kosten anpassen</DialogTitle>
					<DialogDescription>
						Preisaktualisierung erstellt einen neuen Eintrag mit dem heutigen
						Datum.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<label
						className="font-medium text-muted-foreground text-xs"
						htmlFor={`costs-action-${fieldKey}`}
					>
						Aktion
					</label>
					<select
						className="h-9 rounded-md border border-border bg-background px-3 text-sm"
						id={`costs-action-${fieldKey}`}
						onChange={(event) =>
							setMode(event.target.value as "update" | "modify")
						}
						value={mode}
					>
						<option value="update">Preisaktualisierung (neuer Eintrag)</option>
						<option value="modify">Preisänderung (bestehender Eintrag)</option>
					</select>
					<div className="grid gap-3 md:grid-cols-2">
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-request-type-${fieldKey}`}
							>
								Request-Typ
							</label>
							<NativeSelect
								id={`costs-request-type-${fieldKey}`}
								onChange={(event) => {
									const nextType = event.target.value as RequestType;
									setRequestType(nextType);
									setBillingUnit(nextType === "RERANK" ? "SEARCHES" : "TOKENS");
									if (nextType === "RERANK") setTokenType("");
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
								htmlFor={`costs-billing-unit-${fieldKey}`}
							>
								Abrechnungseinheit
							</label>
							<NativeSelect
								id={`costs-billing-unit-${fieldKey}`}
								onChange={(event) =>
									(() => {
										const nextUnit = event.target.value as BillingUnit;
										setBillingUnit(nextUnit);
										setRequestType(
											nextUnit === "SEARCHES" ? "RERANK" : "CHAT_COMPLETION",
										);
										if (nextUnit === "SEARCHES") setTokenType("");
									})()
								}
								value={billingUnit}
							>
								{billingUnitOptions.map((value) => (
									<NativeSelectOption key={value} value={value}>
										{value}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-model-${fieldKey}`}
							>
								Modell
							</label>
							<Input
								id={`costs-model-${fieldKey}`}
								list="costs-models"
								onChange={(event) => setModel(event.target.value)}
								placeholder="gpt-4.1"
								value={model}
							/>
						</div>
						{requestType === "RERANK" ? (
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
									htmlFor={`costs-token-${fieldKey}`}
								>
									Token-Typ
								</label>
								<Input
									id={`costs-token-${fieldKey}`}
									onChange={(event) => setTokenType(event.target.value)}
									placeholder={"input"}
									value={tokenType}
								/>
							</div>
						)}
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-price-${fieldKey}`}
							>
								Preis
							</label>
							<Input
								id={`costs-price-${fieldKey}`}
								min={0}
								onChange={(event) => setPrice(event.target.value)}
								type="number"
								value={price}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-valid-${fieldKey}`}
							>
								Gültig ab
							</label>
							<Input
								disabled={mode === "update"}
								id={`costs-valid-${fieldKey}`}
								onChange={(event) => setValidFrom(event.target.value)}
								type="date"
								value={effectiveValidFrom}
							/>
							{mode === "update" ? (
								<span className="text-muted-foreground text-xs">
									Neuer Eintrag ab {formatDate(today)}
								</span>
							) : null}
						</div>
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-stage-type-${fieldKey}`}
							>
								Stage Typ
							</label>
							<NativeSelect
								className="w-full"
								id={`costs-stage-type-${fieldKey}`}
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
								htmlFor={`costs-stage-min-${fieldKey}`}
							>
								Stage Min Tokens
							</label>
							<Input
								id={`costs-stage-min-${fieldKey}`}
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
								htmlFor={`costs-stage-max-${fieldKey}`}
							>
								Stage Max Tokens
							</label>
							<Input
								id={`costs-stage-max-${fieldKey}`}
								min={0}
								onChange={(event) => setStageMaxTokens(event.target.value)}
								placeholder="(optional)"
								type="number"
								value={stageMaxTokens}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<label
								className="font-medium text-muted-foreground text-xs"
								htmlFor={`costs-unit-${fieldKey}`}
							>
								Einheit
							</label>
							<NativeSelect
								className="w-full"
								id={`costs-unit-${fieldKey}`}
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
								htmlFor={`costs-currency-${fieldKey}`}
							>
								Währung
							</label>
							<Input
								id={`costs-currency-${fieldKey}`}
								maxLength={3}
								onChange={(event) =>
									setCurrency(event.target.value.toUpperCase())
								}
								placeholder="EUR"
								value={currency}
							/>
						</div>
					</div>
				</div>
				<DialogFooter showCloseButton>
					<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
						<Button
							disabled={disabled || !canSubmit}
							onClick={() => {
								const updatePayload: CostPayload = {
									model: model.trim(),
									price: priceValue,
									validFrom: effectiveValidFrom,
									requestType,
									billingUnit,
									tokenType:
										requestType === "RERANK" ? null : tokenType.trim() || null,
									unitOfMessure: unitOfMessure ?? null,
									currency: currency.trim() || null,
									stageType:
										requestType === "RERANK"
											? CostStageType.ContextLength
											: stageType,
									stageMinTokens: requestType === "RERANK" ? 0 : stageMinTokens,
									stageMaxTokens:
										requestType === "RERANK" ? null : stageMaxTokensValue,
								};

								if (mode === "update") {
									onUpdatePricing({ update: updatePayload });
									setOpen(false);
									return;
								}

								onUpdateCost({
									original: originalPayload,
									update: updatePayload,
								});
								setOpen(false);
							}}
						>
							{disabled ? "Speichern..." : "Speichern"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function CostsTable({
	data,
	isLoading,
	onUpdateCost,
	onUpdatePricing,
	isMutating,
}: {
	data: CostRow[];
	isLoading: boolean;
	onUpdateCost: (payload: CostUpdatePayload) => void;
	onUpdatePricing: (payload: CostPricingPayload) => void;
	isMutating: boolean;
}) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [modelFilter, setModelFilter] = useState("");
	const [requestTypeFilter, setRequestTypeFilter] = useState<
		"ALL" | RequestType
	>("ALL");
	const [tokenFilter, setTokenFilter] = useState("");
	const [currencyFilter, setCurrencyFilter] = useState("");
	const [pagination, setPagination] = useState({
		pageIndex: 0,
		pageSize: 20,
	});

	const filteredData = useMemo(() => {
		const search = globalFilter.trim().toLowerCase();
		return data.filter((row) => {
			if (
				requestTypeFilter !== "ALL" &&
				row.requestType !== requestTypeFilter
			) {
				return false;
			}
			if (
				modelFilter &&
				!row.model.toLowerCase().includes(modelFilter.toLowerCase())
			) {
				return false;
			}
			if (
				tokenFilter &&
				!(row.tokenType ?? "").toLowerCase().includes(tokenFilter.toLowerCase())
			) {
				return false;
			}
			if (
				currencyFilter &&
				(row.currency ?? "").toLowerCase() !== currencyFilter.toLowerCase()
			) {
				return false;
			}
			if (!search) return true;
			const values = [
				row.model,
				row.requestType,
				row.billingUnit,
				row.tokenType,
				row.price,
				row.unitOfMessure ?? "",
				row.currency ?? "",
				row.stageType ?? "",
				row.stageMinTokens,
				row.stageMaxTokens ?? "",
				formatDate(row.validFrom),
			];
			return values
				.map((value) => String(value).toLowerCase())
				.some((value) => value.includes(search));
		});
	}, [
		currencyFilter,
		data,
		globalFilter,
		modelFilter,
		requestTypeFilter,
		tokenFilter,
	]);

	const columns = useMemo<ColumnDef<CostRow>[]>(
		() => [
			{
				accessorKey: "model",
				header: "Modell",
			},
			{
				accessorKey: "tokenType",
				header: "Token-Typ",
			},
			{
				accessorKey: "requestType",
				header: "Request-Typ",
			},
			{
				accessorKey: "billingUnit",
				header: "Abrechnungseinheit",
			},
			{
				accessorKey: "stageType",
				header: "Stage Typ",
				cell: ({ getValue }) => getValue<string | null>() ?? "—",
			},
			{
				accessorKey: "stageMinTokens",
				header: "Stage Min",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
			},
			{
				accessorKey: "stageMaxTokens",
				header: "Stage Max",
				cell: ({ getValue }) => {
					const v = getValue<number | null>();
					return v === null ? "∞" : formatNumber(v);
				},
			},
			{
				accessorKey: "price",
				header: "Preis",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "unitOfMessure",
				header: "Einheit",
				cell: ({ getValue }) => getValue<string | null>() ?? "—",
			},
			{
				accessorKey: "currency",
				header: "Währung",
				cell: ({ getValue }) => getValue<string | null>() ?? "—",
			},
			{
				accessorKey: "validFrom",
				header: "Gültig ab",
				cell: ({ getValue }) => formatDate(getValue<string | null>()),
				sortingFn: (rowA, rowB, columnId) => {
					const a = rowA.getValue<string | null>(columnId);
					const b = rowB.getValue<string | null>(columnId);
					const aTime = a ? new Date(a).getTime() : 0;
					const bTime = b ? new Date(b).getTime() : 0;
					return aTime === bTime ? 0 : aTime > bTime ? 1 : -1;
				},
			},
			{
				id: "actions",
				header: "Aktion",
				cell: ({ row }) => (
					<CostEditDialog
						disabled={isMutating}
						onUpdateCost={onUpdateCost}
						onUpdatePricing={onUpdatePricing}
						row={row.original}
					/>
				),
			},
		],
		[isMutating, onUpdateCost, onUpdatePricing],
	);

	const table = useReactTable({
		data: filteredData,
		columns,
		state: {
			sorting,
			pagination,
		},
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when filters change.
	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [
		globalFilter,
		modelFilter,
		requestTypeFilter,
		tokenFilter,
		currencyFilter,
		data.length,
	]);

	const totalRows = table.getFilteredRowModel().rows.length;
	const startRow =
		totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
	const endRow = Math.min(
		totalRows,
		(pagination.pageIndex + 1) * pagination.pageSize,
	);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="font-semibold text-sm">Preisliste</h2>
						<p className="text-muted-foreground text-xs">
							Filtere und durchsuche alle Kosten-Einträge.
						</p>
					</div>
					<div className="text-muted-foreground text-xs">
						{totalRows} Einträge
					</div>
				</div>
				<div className="grid gap-2 md:grid-cols-6">
					<Input
						onChange={(event) => setGlobalFilter(event.target.value)}
						placeholder="Suche"
						value={globalFilter}
					/>
					<Input
						onChange={(event) => setModelFilter(event.target.value)}
						placeholder="Modell"
						value={modelFilter}
					/>
					<NativeSelect
						aria-label="Request-Typ"
						onChange={(event) =>
							setRequestTypeFilter(event.target.value as "ALL" | RequestType)
						}
						value={requestTypeFilter}
					>
						<NativeSelectOption value="ALL">
							Alle Request-Typen
						</NativeSelectOption>
						{requestTypeOptions.map((value) => (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<Input
						onChange={(event) => setTokenFilter(event.target.value)}
						placeholder="Token-Typ"
						value={tokenFilter}
					/>
					<Input
						onChange={(event) => setCurrencyFilter(event.target.value)}
						placeholder="Währung"
						value={currencyFilter}
					/>
				</div>
				{globalFilter ||
				modelFilter ||
				requestTypeFilter !== "ALL" ||
				tokenFilter ||
				currencyFilter ? (
					<div>
						<Button
							onClick={() => {
								setGlobalFilter("");
								setModelFilter("");
								setRequestTypeFilter("ALL");
								setTokenFilter("");
								setCurrencyFilter("");
							}}
							size="sm"
							variant="outline"
						>
							Filter zurücksetzen
						</Button>
					</div>
				) : null}
			</div>
			<div className="rounded-lg border border-border">
				<Table className="min-w-full border-separate border-spacing-0 text-sm">
					<TableHeader className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const sorted = header.column.getIsSorted();
									return (
										<TableHead
											className="border-border border-b px-4 py-3 text-left"
											key={header.id}
										>
											{header.isPlaceholder ? null : (
												<button
													className="inline-flex items-center gap-1"
													onClick={header.column.getToggleSortingHandler()}
													type="button"
												>
													{flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
													{sorted === "asc" ? (
														<ChevronUp className="h-3 w-3" />
													) : sorted === "desc" ? (
														<ChevronDown className="h-3 w-3" />
													) : (
														<ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
													)}
												</button>
											)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell
									className="px-4 py-8 text-center text-muted-foreground text-sm"
									colSpan={columns.length}
								>
									Lade Preise...
								</TableCell>
							</TableRow>
						) : null}
						{!isLoading && table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									className="px-4 py-8 text-center text-muted-foreground text-sm"
									colSpan={columns.length}
								>
									Keine Einträge gefunden.
								</TableCell>
							</TableRow>
						) : null}
						{table.getRowModel().rows.map((row) => (
							<TableRow className="hover:bg-muted/40" key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										className="border-border border-b px-4 py-3"
										key={cell.id}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
				<div className="flex flex-col gap-2 border-border border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2 text-muted-foreground text-xs">
						<span>Zeilen pro Seite</span>
						<NativeSelect
							className="w-[90px]"
							onChange={(event) =>
								setPagination((prev) => ({
									...prev,
									pageSize: Number(event.target.value),
									pageIndex: 0,
								}))
							}
							size="sm"
							value={String(pagination.pageSize)}
						>
							{[10, 20, 50].map((size) => (
								<NativeSelectOption key={size} value={String(size)}>
									{size}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="flex items-center gap-3">
						<span className="text-muted-foreground text-xs">
							{startRow}-{endRow} von {totalRows}
						</span>
						<div className="flex items-center gap-1">
							<Button
								disabled={!table.getCanPreviousPage()}
								onClick={() => table.setPageIndex(0)}
								size="sm"
								variant="outline"
							>
								Erste
							</Button>
							<Button
								disabled={!table.getCanPreviousPage()}
								onClick={() => table.previousPage()}
								size="sm"
								variant="outline"
							>
								Zurück
							</Button>
							<Button
								disabled={!table.getCanNextPage()}
								onClick={() => table.nextPage()}
								size="sm"
								variant="outline"
							>
								Weiter
							</Button>
							<Button
								disabled={!table.getCanNextPage()}
								onClick={() => table.setPageIndex(table.getPageCount() - 1)}
								size="sm"
								variant="outline"
							>
								Letzte
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
