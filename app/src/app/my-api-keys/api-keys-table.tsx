"use client";

import {
	type ColumnDef,
	type ExpandedState,
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
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
							aria-label={row.getIsExpanded() ? "Einklappen" : "Ausklappen"}
							className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-muted-foreground transition hover:bg-muted"
							onClick={row.getToggleExpandedHandler()}
							type="button"
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
							<span className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
								<span className="text-[0.7rem]">Modell</span>
								<span className="font-semibold text-foreground text-sm">
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
		[],
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when filters or data change.
	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [globalFilter, data.length]);

	const totalRows = table.getFilteredRowModel().rows.length;
	const startRow =
		totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
	const endRow = Math.min(
		totalRows,
		(pagination.pageIndex + 1) * pagination.pageSize,
	);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-1 flex-wrap items-center justify-between gap-3">
					<div className="flex grow items-center gap-2">
						<Input
							className="max-w-sm"
							onChange={(event) => setGlobalFilter(event.target.value)}
							placeholder="Nach ID, Beschreibung oder Tokens filtern"
							value={globalFilter}
						/>
						<span className="text-muted-foreground text-sm">
							{totalRows} API-Key{totalRows === 1 ? "" : "s"}
						</span>
					</div>
					{action ? <div className="shrink-0">{action}</div> : null}
				</div>
				{globalFilter ? (
					<Button
						onClick={() => setGlobalFilter("")}
						size="sm"
						variant="outline"
					>
						Zurücksetzen
					</Button>
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
											{header.isPlaceholder ? null : header.column.getCanSort() ? (
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
											) : (
												flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)
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
								className={`hover:bg-muted/40 ${row.depth > 0 ? "bg-muted/20" : ""}`}
								key={row.id}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										className={`border-border border-b px-4 py-3 ${
											cell.column.id === "description" && row.depth > 0
												? "pl-10"
												: ""
										}`}
										key={cell.id}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
						{table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									className="px-4 py-8 text-center text-muted-foreground text-sm"
									colSpan={columns.length}
								>
									Keine API-Keys passen zu diesem Filter.
								</TableCell>
							</TableRow>
						) : null}
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
