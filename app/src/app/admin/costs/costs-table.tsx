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
import { type CostUnit, costUnitOptions } from "~/lib/costs";

export type CostRow = {
	model: string;
	price: number;
	validFrom: string | null;
	tokenType: string;
	unitOfMessure: CostUnit | null;
	isRegional: boolean;
	backendName: string;
	currency: string | null;
};

type CostPayload = {
	model: string;
	price: number;
	validFrom?: string;
	tokenType: string;
	unitOfMessure?: CostUnit | null;
	isRegional: boolean;
	backendName: string;
	currency?: string | null;
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
	const [tokenType, setTokenType] = useState(row.tokenType);
	const [price, setPrice] = useState(String(row.price));
	const [validFrom, setValidFrom] = useState(row.validFrom ?? todayString());
	const [unitOfMessure, setUnitOfMessure] = useState<CostUnit>(
		costUnitOptions.includes((row.unitOfMessure ?? "") as CostUnit)
			? ((row.unitOfMessure ?? defaultUnit) as CostUnit)
			: defaultUnit,
	);
	const [isRegional, setIsRegional] = useState(row.isRegional);
	const [backendName, setBackendName] = useState(row.backendName);
	const [currency, setCurrency] = useState(row.currency ?? "");
	const fieldKey = `${row.model}-${row.tokenType}-${row.price}`.replace(
		/[^a-zA-Z0-9-_]/g,
		"-",
	);

	const priceValue = useMemo(() => Number.parseInt(price, 10), [price]);
	const canSubmit =
		model.trim().length > 0 &&
		backendName.trim().length > 0 &&
		tokenType.trim().length > 0 &&
		!Number.isNaN(priceValue);

	const originalPayload = useMemo<CostPayload>(
		() => ({
			model: row.model,
			price: row.price,
			validFrom: row.validFrom ?? undefined,
			tokenType: row.tokenType,
			unitOfMessure: row.unitOfMessure ?? null,
			isRegional: row.isRegional,
			backendName: row.backendName,
			currency: row.currency ?? null,
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
					setTokenType(row.tokenType);
					setPrice(String(row.price));
					setValidFrom(row.validFrom ?? todayString());
					setUnitOfMessure(row.unitOfMessure ?? defaultUnit);
					setIsRegional(row.isRegional);
					setBackendName(row.backendName);
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
								placeholder="input"
								value={tokenType}
							/>
						</div>
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
								htmlFor={`costs-backend-${fieldKey}`}
							>
								Backend
							</label>
							<Input
								id={`costs-backend-${fieldKey}`}
								onChange={(event) => setBackendName(event.target.value)}
								placeholder="openai"
								value={backendName}
							/>
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
						<div className="flex items-center gap-2">
							<input
								checked={isRegional}
								className="h-4 w-4 rounded border-border"
								id={`costs-regional-${row.model}-${row.tokenType}-${row.price}`}
								onChange={(event) => setIsRegional(event.target.checked)}
								type="checkbox"
							/>
							<label
								className="text-sm"
								htmlFor={`costs-regional-${row.model}-${row.tokenType}-${row.price}`}
							>
								Regionale Preisgestaltung
							</label>
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
									tokenType: tokenType.trim(),
									unitOfMessure: unitOfMessure ?? null,
									isRegional,
									backendName: backendName.trim(),
									currency: currency.trim() || null,
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
	const [backendFilter, setBackendFilter] = useState("");
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
				modelFilter &&
				!row.model.toLowerCase().includes(modelFilter.toLowerCase())
			) {
				return false;
			}
			if (
				backendFilter &&
				!row.backendName.toLowerCase().includes(backendFilter.toLowerCase())
			) {
				return false;
			}
			if (
				tokenFilter &&
				!row.tokenType.toLowerCase().includes(tokenFilter.toLowerCase())
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
				row.tokenType,
				row.price,
				row.unitOfMessure ?? "",
				row.backendName,
				row.currency ?? "",
				row.isRegional ? "regional" : "standard",
				formatDate(row.validFrom),
			];
			return values
				.map((value) => String(value).toLowerCase())
				.some((value) => value.includes(search));
		});
	}, [
		backendFilter,
		currencyFilter,
		data,
		globalFilter,
		modelFilter,
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
				accessorKey: "backendName",
				header: "Backend",
			},
			{
				accessorKey: "isRegional",
				header: "Region",
				cell: ({ getValue }) => (getValue<boolean>() ? "Regional" : "Standard"),
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
		backendFilter,
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
				<div className="grid gap-2 md:grid-cols-5">
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
					<Input
						onChange={(event) => setBackendFilter(event.target.value)}
						placeholder="Backend"
						value={backendFilter}
					/>
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
				backendFilter ||
				tokenFilter ||
				currencyFilter ? (
					<div>
						<Button
							onClick={() => {
								setGlobalFilter("");
								setModelFilter("");
								setBackendFilter("");
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
