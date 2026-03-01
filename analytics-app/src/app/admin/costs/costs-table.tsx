"use client";

import { useEffect, useMemo, useState } from "react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { costUnitOptions } from "~/lib/costs";

export type CostRow = {
	model: string;
	price: number;
	validFrom: string | null;
	tokenType: string;
	unitOfMessure: string | null;
	isRegional: boolean;
	backendName: string;
	currency: string | null;
};

type CostPayload = {
	model: string;
	price: number;
	validFrom?: string;
	tokenType: string;
	unitOfMessure?: string | null;
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
	const [unitOfMessure, setUnitOfMessure] = useState(row.unitOfMessure ?? defaultUnit);
	const [isRegional, setIsRegional] = useState(row.isRegional);
	const [backendName, setBackendName] = useState(row.backendName);
	const [currency, setCurrency] = useState(row.currency ?? "");

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
		[row]
	);

	const today = useMemo(() => todayString(), []);
	const effectiveValidFrom = mode === "update" ? today : validFrom;

	return (
		<Dialog
			open={open}
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
		>
			<DialogTrigger render={<Button size="sm" variant="outline" />}>
				Bearbeiten
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Kosten anpassen</DialogTitle>
					<DialogDescription>
						Update pricing erstellt einen neuen Eintrag mit dem heutigen Datum.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<label className="text-xs font-medium text-muted-foreground">Aktion</label>
					<select
						value={mode}
						onChange={(event) => setMode(event.target.value as "update" | "modify")}
						className="h-9 rounded-md border border-border bg-background px-3 text-sm"
					>
						<option value="update">Update pricing (neuer Eintrag)</option>
						<option value="modify">Modify pricing (bestehender Eintrag)</option>
					</select>
					<div className="grid gap-3 md:grid-cols-2">
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
								min={0}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-muted-foreground">Gültig ab</label>
							<Input
								type="date"
								value={effectiveValidFrom}
								onChange={(event) => setValidFrom(event.target.value)}
								disabled={mode === "update"}
							/>
							{mode === "update" ? (
								<span className="text-xs text-muted-foreground">
									Neuer Eintrag ab {formatDate(today)}
								</span>
							) : null}
						</div>
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-muted-foreground">Einheit</label>
							<NativeSelect
								value={unitOfMessure}
								onChange={(event) => setUnitOfMessure(event.target.value)}
								className="w-full"
							>
								{costUnitOptions.map((unit) => (
									<NativeSelectOption key={unit} value={unit}>
										{unit}
									</NativeSelectOption>
								))}
							</NativeSelect>
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
								onChange={(event) =>
									setCurrency(event.target.value.toUpperCase())
								}
								placeholder="EUR"
								maxLength={3}
							/>
						</div>
						<div className="flex items-center gap-2">
							<input
								id={`costs-regional-${row.model}-${row.tokenType}-${row.price}`}
								type="checkbox"
								checked={isRegional}
								onChange={(event) => setIsRegional(event.target.checked)}
								className="h-4 w-4 rounded border-border"
							/>
							<label
								htmlFor={`costs-regional-${row.model}-${row.tokenType}-${row.price}`}
								className="text-sm"
							>
								Regional pricing
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
									unitOfMessure: unitOfMessure.trim() || null,
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
			if (modelFilter && !row.model.toLowerCase().includes(modelFilter.toLowerCase())) {
				return false;
			}
			if (backendFilter && !row.backendName.toLowerCase().includes(backendFilter.toLowerCase())) {
				return false;
			}
			if (tokenFilter && !row.tokenType.toLowerCase().includes(tokenFilter.toLowerCase())) {
				return false;
			}
			if (currencyFilter && (row.currency ?? "").toLowerCase() !== currencyFilter.toLowerCase()) {
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
	}, [backendFilter, currencyFilter, data, globalFilter, modelFilter, tokenFilter]);

	const columns = useMemo<ColumnDef<CostRow>[]>(
		() => [
			{
				accessorKey: "model",
				header: "Model",
			},
			{
				accessorKey: "tokenType",
				header: "Token",
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
						row={row.original}
						onUpdateCost={onUpdateCost}
						onUpdatePricing={onUpdatePricing}
						disabled={isMutating}
					/>
				),
			},
		],
		[isMutating, onUpdateCost, onUpdatePricing]
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

	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [globalFilter, modelFilter, backendFilter, tokenFilter, currencyFilter, data.length]);

	const totalRows = table.getFilteredRowModel().rows.length;
	const startRow = totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
	const endRow = Math.min(totalRows, (pagination.pageIndex + 1) * pagination.pageSize);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-sm font-semibold">Preisliste</h2>
						<p className="text-xs text-muted-foreground">
							Filtere und durchsuche alle Kosten-Einträge.
						</p>
					</div>
					<div className="text-xs text-muted-foreground">
						{totalRows} Einträge
					</div>
				</div>
				<div className="grid gap-2 md:grid-cols-5">
					<Input
						placeholder="Suche"
						value={globalFilter}
						onChange={(event) => setGlobalFilter(event.target.value)}
					/>
					<Input
						placeholder="Model"
						value={modelFilter}
						onChange={(event) => setModelFilter(event.target.value)}
					/>
					<Input
						placeholder="Backend"
						value={backendFilter}
						onChange={(event) => setBackendFilter(event.target.value)}
					/>
					<Input
						placeholder="Token type"
						value={tokenFilter}
						onChange={(event) => setTokenFilter(event.target.value)}
					/>
					<Input
						placeholder="Währung"
						value={currencyFilter}
						onChange={(event) => setCurrencyFilter(event.target.value)}
					/>
				</div>
				{globalFilter || modelFilter || backendFilter || tokenFilter || currencyFilter ? (
					<div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setGlobalFilter("");
								setModelFilter("");
								setBackendFilter("");
								setTokenFilter("");
								setCurrencyFilter("");
							}}
						>
							Filter zurücksetzen
						</Button>
					</div>
				) : null}
			</div>
			<div className="rounded-lg border border-border">
				<Table className="min-w-full border-separate border-spacing-0 text-sm">
					<TableHeader className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const sorted = header.column.getIsSorted();
									return (
										<TableHead
											key={header.id}
											className="border-b border-border px-4 py-3 text-left"
										>
											{header.isPlaceholder ? null : (
												<button
													type="button"
													className="inline-flex items-center gap-1"
													onClick={header.column.getToggleSortingHandler()}
												>
													{flexRender(
														header.column.columnDef.header,
														header.getContext()
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
									colSpan={columns.length}
									className="px-4 py-8 text-center text-sm text-muted-foreground"
								>
									Lade Preise...
								</TableCell>
							</TableRow>
						) : null}
						{!isLoading && table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="px-4 py-8 text-center text-sm text-muted-foreground"
								>
									Keine Einträge gefunden.
								</TableCell>
							</TableRow>
						) : null}
						{table.getRowModel().rows.map((row) => (
							<TableRow key={row.id} className="hover:bg-muted/40">
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className="border-b border-border px-4 py-3"
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
				<div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>Rows per page</span>
						<NativeSelect
							value={String(pagination.pageSize)}
							onChange={(event) =>
								setPagination((prev) => ({
									...prev,
									pageSize: Number(event.target.value),
									pageIndex: 0,
								}))
							}
							className="w-[90px]"
							size="sm"
						>
							{[10, 20, 50].map((size) => (
								<NativeSelectOption key={size} value={String(size)}>
									{size}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="flex items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{startRow}-{endRow} of {totalRows}
						</span>
						<div className="flex items-center gap-1">
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.setPageIndex(0)}
								disabled={!table.getCanPreviousPage()}
							>
								First
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.previousPage()}
								disabled={!table.getCanPreviousPage()}
							>
								Prev
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.nextPage()}
								disabled={!table.getCanNextPage()}
							>
								Next
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.setPageIndex(table.getPageCount() - 1)}
								disabled={!table.getCanNextPage()}
							>
								Last
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
