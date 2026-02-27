"use client";

import { useMemo, useState } from "react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

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

	const columns = useMemo<ColumnDef<ApiKeyRow>[]>(
		() => [
			{
				accessorKey: "id",
				header: "API Key ID",
			},
			{
				accessorKey: "description",
				header: "Description",
				cell: ({ getValue }) => {
					const value = getValue<string | null>();
					return value?.trim() ? value : "—";
				},
			},
			{
				accessorKey: "inputTokens",
				header: "Used Input Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "cachedInputTokens",
				header: "Used Input Cache Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "outputTokens",
				header: "Used Output Tokens",
				cell: ({ getValue }) => formatNumber(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "createdAt",
				header: "Creation Date",
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
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
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

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-1 items-center gap-3">
					<Input
						placeholder="Filter by id, description, or tokens"
						value={globalFilter}
						onChange={(event) => setGlobalFilter(event.target.value)}
						className="max-w-sm"
					/>
					<span className="text-sm text-muted-foreground">
						{table.getFilteredRowModel().rows.length} key
						{table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
					</span>
				</div>
				{globalFilter ? (
					<Button variant="outline" size="sm" onClick={() => setGlobalFilter("")}
					>
						Clear
					</Button>
				) : null}
			</div>
			<div className="overflow-x-auto rounded-lg border border-border">
				<table className="min-w-full border-separate border-spacing-0 text-sm">
					<thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const sorted = header.column.getIsSorted();
									return (
										<th
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
										</th>
									);
								})}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr key={row.id} className="hover:bg-muted/40">
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className="border-b border-border px-4 py-3">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
						{table.getRowModel().rows.length === 0 ? (
							<tr>
								<td
									colSpan={columns.length}
									className="px-4 py-8 text-center text-sm text-muted-foreground"
								>
									No API keys match this filter.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}
