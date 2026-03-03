"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type ExpandedState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";

export type ApiKeyTableRow = {
	kind: "key" | "model";
	id?: string;
	description?: string | null;
	model?: string | null;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	createdAt?: string | null;
	cost: number | null;
	currency?: string | null;
	subRows?: ApiKeyTableRow[];
};

const numberFormatter = new Intl.NumberFormat("en-US");
const costFormatter = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "short",
	day: "2-digit",
});

function formatDate(value: string | null) {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateFormatter.format(date);
}

function formatNumber(value: number) {
	return numberFormatter.format(value ?? 0);
}

function formatCost(value: number | null, currency?: string | null) {
	if (value === null || Number.isNaN(value)) return "—";
	const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
	return `${costFormatter.format(value)}${symbol}`;
}

export function ApiKeysTable({
	data,
	action,
}: {
	data: ApiKeyTableRow[];
	action?: ReactNode;
}) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [expanded, setExpanded] = useState<ExpandedState>({});
	const [pagination, setPagination] = useState({
		pageIndex: 0,
		pageSize: 10,
	});

	const columns = useMemo<ColumnDef<ApiKeyTableRow>[]>(
		() => [
			{
				id: "expander",
				header: "",
				enableSorting: false,
				cell: ({ row }) =>
					row.getCanExpand() ? (
						<button
							type="button"
							aria-label={row.getIsExpanded() ? "Einklappen" : "Ausklappen"}
							onClick={row.getToggleExpandedHandler()}
							className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-muted-foreground transition hover:bg-muted"
						>
							<ChevronDown
								className={`h-4 w-4 transition-transform ${
									row.getIsExpanded() ? "rotate-180" : ""
								}`}
							/>
						</button>
					) : null,
			},
			{
				accessorKey: "description",
				header: "Beschreibung / Modell",
				cell: ({ row, getValue }) => {
					if (row.original.kind === "model") {
						return (
							<span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								<span className="text-[0.7rem]">Modell</span>
								<span className="text-sm font-semibold text-foreground">
									{row.original.model ?? "Unbekannt"}
								</span>
							</span>
						);
					}
					const value = getValue<string | null>();
					return value?.trim() ? value : "—";
				},
			},
			{
				accessorKey: "inputTokens",
				header: "Verwendete Input-Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "cachedInputTokens",
				header: "Verwendete Input-Cache-Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "outputTokens",
				header: "Verwendete Output-Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "cost",
				header: "Kosten",
				cell: ({ row, getValue }) =>
					row.original.kind === "model"
						? formatCost(getValue<number | null>(), row.original.currency)
						: formatCost(getValue<number | null>(), row.original.currency),
				sortingFn: (rowA, rowB, columnId) => {
					const a = rowA.getValue<number | null>(columnId) ?? 0;
					const b = rowB.getValue<number | null>(columnId) ?? 0;
					return a === b ? 0 : a > b ? 1 : -1;
				},
			},
			{
				accessorKey: "createdAt",
				header: "Erstellungsdatum",
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
				accessorKey: "id",
				header: "API-Key-ID",
				cell: ({ row, getValue }) =>
					row.original.kind === "model" ? "—" : (getValue<string>() ?? "—"),
			},
		],
		[]
	);

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			globalFilter,
			pagination,
			expanded,
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onPaginationChange: setPagination,
		onExpandedChange: setExpanded,
		getCoreRowModel: getCoreRowModel(),
		getExpandedRowModel: getExpandedRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getRowCanExpand: (row) => (row.original.subRows?.length ?? 0) > 0,
		getSubRows: (row) => row.subRows,
		globalFilterFn: (row, _columnId, filterValue) => {
			const search = String(filterValue).toLowerCase().trim();
			if (!search) return true;
			const createdLabel = formatDate(row.original.createdAt ?? null);
			return [
				row.original.id ?? "",
				row.original.description ?? "",
				row.original.model ?? "",
				row.original.inputTokens,
				row.original.cachedInputTokens,
				row.original.outputTokens,
				row.original.cost ?? "",
				createdLabel,
			]
				.map((value) => String(value).toLowerCase())
				.some((value) => value.includes(search));
		},
	});

	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [globalFilter, data.length]);

	const totalRows = table.getFilteredRowModel().rows.length;
	const startRow = totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
	const endRow = Math.min(totalRows, (pagination.pageIndex + 1) * pagination.pageSize);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-1 flex-wrap items-center gap-3 justify-between">
					<div className="flex grow items-center gap-2">
						<Input
							placeholder="Nach ID, Beschreibung oder Tokens filtern"
							value={globalFilter}
							onChange={(event) => setGlobalFilter(event.target.value)}
							className="max-w-sm"
						/>
					<span className="text-sm text-muted-foreground">
						{totalRows} API-Key{totalRows === 1 ? "" : "s"}
					</span>
					</div>
					{action ? <div className="shrink-0">{action}</div> : null}
				</div>
				{globalFilter ? (
					<Button variant="outline" size="sm" onClick={() => setGlobalFilter("")}
					>
						Zurücksetzen
					</Button>
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
											{header.isPlaceholder ? null : header.column.getCanSort() ? (
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
											) : (
												flexRender(header.column.columnDef.header, header.getContext())
											)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.map((row) => (
							<TableRow
								key={row.id}
								className={`hover:bg-muted/40 ${row.depth > 0 ? "bg-muted/20" : ""}`}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className={`border-b border-border px-4 py-3 ${
											cell.column.id === "description" && row.depth > 0
												? "pl-10"
												: ""
										}`}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
						{table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="px-4 py-8 text-center text-sm text-muted-foreground"
								>
									Keine API-Keys passen zu diesem Filter.
								</TableCell>
							</TableRow>
						) : null}
					</TableBody>
				</Table>
				<div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>Zeilen pro Seite</span>
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
							{startRow}-{endRow} von {totalRows}
						</span>
							<div className="flex items-center gap-1">
								<Button
									variant="outline"
									size="sm"
									onClick={() => table.setPageIndex(0)}
									disabled={!table.getCanPreviousPage()}
								>
									Erste
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => table.previousPage()}
									disabled={!table.getCanPreviousPage()}
								>
									Zurück
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => table.nextPage()}
									disabled={!table.getCanNextPage()}
								>
									Weiter
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => table.setPageIndex(table.getPageCount() - 1)}
									disabled={!table.getCanNextPage()}
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
