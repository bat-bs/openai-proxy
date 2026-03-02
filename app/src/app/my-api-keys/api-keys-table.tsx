"use client";

import { useEffect, useMemo, useState } from "react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
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

export type ApiKeyRow = {
	id: string;
	description: string | null;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	createdAt: string | null;
};

const numberFormatter = new Intl.NumberFormat("en-US");
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

export function ApiKeysTable({ data }: { data: ApiKeyRow[] }) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [pagination, setPagination] = useState({
		pageIndex: 0,
		pageSize: 10,
	});

	const columns = useMemo<ColumnDef<ApiKeyRow>[]>(
		() => [
			{
				accessorKey: "id",
				header: "API-Key-ID",
			},
			{
				accessorKey: "description",
				header: "Beschreibung",
				cell: ({ getValue }) => {
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
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		globalFilterFn: (row, _columnId, filterValue) => {
			const search = String(filterValue).toLowerCase().trim();
			if (!search) return true;
			const createdLabel = formatDate(row.original.createdAt);
			return [
				row.original.id,
				row.original.description ?? "",
				row.original.inputTokens,
				row.original.cachedInputTokens,
				row.original.outputTokens,
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
				<div className="flex flex-1 items-center gap-3">
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
