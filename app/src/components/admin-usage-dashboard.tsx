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
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Pie, PieChart } from "recharts";

import { Button } from "~/components/ui/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
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
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

type UsageModel = {
	model: string;
	tokens: number;
};

type UsageUser = {
	id: string;
	name: string;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	lastActivity: string | null;
};

type UsageStats = {
	totalTokens: number;
	modelUsage: UsageModel[];
	users: UsageUser[];
};

const ranges = [
	{ value: "24h", label: "24 Stunden" },
	{ value: "7d", label: "7 Tage" },
	{ value: "30d", label: "30 Tage" },
	{ value: "all", label: "Allzeit" },
] as const;

const chartColors = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

export function AdminUsageDashboard({
	range,
	stats,
}: {
	range: (typeof ranges)[number]["value"];
	stats: UsageStats;
}) {
	const router = useRouter();
	const numberFormatter = new Intl.NumberFormat("de-DE");
	const dateFormatter = new Intl.DateTimeFormat("de-DE", {
		dateStyle: "medium",
		timeStyle: "short",
	});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [pagination, setPagination] = useState({
		pageIndex: 0,
		pageSize: 10,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when users change.
	useEffect(() => {
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, [stats.users.length]);

	const pieData = stats.modelUsage.map((item, index) => {
		const key = `model-${index}`;
		return {
			key,
			model: item.model,
			tokens: item.tokens,
			fill: `var(--color-${key})`,
		};
	});

	const chartConfig = pieData.reduce<ChartConfig>((acc, item, index) => {
		acc[item.key] = {
			label: item.model,
			color: chartColors[index % chartColors.length],
		};
		return acc;
	}, {});

	const columns = useMemo<ColumnDef<UsageUser>[]>(
		() => [
			{
				accessorKey: "name",
				header: "Benutzername",
				cell: ({ getValue }) => (
					<span className="font-medium">{getValue<string>()}</span>
				),
			},
			{
				accessorKey: "inputTokens",
				header: "Input-Tokens",
				cell: ({ getValue }) => numberFormatter.format(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "cachedTokens",
				header: "Cache-Tokens",
				cell: ({ getValue }) => numberFormatter.format(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "outputTokens",
				header: "Output-Tokens",
				cell: ({ getValue }) => numberFormatter.format(getValue<number>()),
				sortingFn: "basic",
			},
			{
				accessorKey: "lastActivity",
				header: "Letzte Aktivität",
				cell: ({ getValue }) => {
					const value = getValue<string | null>();
					return value ? dateFormatter.format(new Date(value)) : "—";
				},
				sortingFn: (rowA, rowB, columnId) => {
					const a = rowA.getValue<string | null>(columnId);
					const b = rowB.getValue<string | null>(columnId);
					const aTime = a ? new Date(a).getTime() : 0;
					const bTime = b ? new Date(b).getTime() : 0;
					return aTime === bTime ? 0 : aTime > bTime ? 1 : -1;
				},
			},
		],
		[dateFormatter, numberFormatter],
	);

	const table = useReactTable({
		data: stats.users,
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

	const totalUsers = table.getPrePaginationRowModel().rows.length;
	const startRow =
		totalUsers === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
	const endRow = Math.min(
		totalUsers,
		(pagination.pageIndex + 1) * pagination.pageSize,
	);

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<h1 className="font-semibold text-2xl">Nutzungsstatistiken</h1>
					<Tabs
						onValueChange={(value) =>
							router.push(`/admin/usage?range=${value}`)
						}
						value={range}
					>
						<TabsList variant="line">
							{ranges.map((item) => (
								<TabsTrigger key={item.value} value={item.value}>
									{item.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				</div>
				<div className="rounded-none border border-border bg-card p-6">
					<div className="text-muted-foreground text-xs uppercase tracking-wide">
						Verbrauchte Tokens
					</div>
					<div className="mt-2 font-semibold text-3xl">
						Verbrauchte Tokens: {numberFormatter.format(stats.totalTokens)}
					</div>
				</div>
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="rounded-none border border-border bg-card p-4">
					<div className="font-medium text-muted-foreground text-xs">
						Nutzungsverteilung nach Modell
					</div>
					<div className="mt-4">
						{pieData.length ? (
							<ChartContainer className="h-72" config={chartConfig}>
								<PieChart>
									<ChartTooltip
										content={<ChartTooltipContent nameKey="key" />}
									/>
									<Pie
										data={pieData}
										dataKey="tokens"
										innerRadius={60}
										nameKey="key"
										stroke="var(--background)"
										strokeWidth={2}
									/>
									<ChartLegend content={<ChartLegendContent nameKey="key" />} />
								</PieChart>
							</ChartContainer>
						) : (
							<div className="text-muted-foreground text-xs">
								Keine Nutzungsdaten für diesen Zeitraum.
							</div>
						)}
					</div>
				</div>

				<div className="rounded-none border border-border bg-card p-4">
					<div className="font-medium text-muted-foreground text-xs">
						Nutzung nach Benutzer
					</div>
					<div className="mt-4">
						<Table className="border-collapse text-xs">
							<TableHeader>
								{table.getHeaderGroups().map((headerGroup) => (
									<TableRow
										className="border-border text-left text-[11px] text-muted-foreground uppercase tracking-wide"
										key={headerGroup.id}
									>
										{headerGroup.headers.map((header) => {
											const sorted = header.column.getIsSorted();
											return (
												<TableHead
													className="pr-3 pb-2 font-medium"
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
										className="border-border/60 last:border-0"
										key={row.id}
									>
										{row.getVisibleCells().map((cell) => (
											<TableCell className="py-2 pr-3" key={cell.id}>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										))}
									</TableRow>
								))}
								{!stats.users.length ? (
									<TableRow>
										<TableCell
											className="py-4 text-center text-muted-foreground"
											colSpan={5}
										>
											Keine Benutzer gefunden.
										</TableCell>
									</TableRow>
								) : null}
							</TableBody>
						</Table>
						<div className="mt-3 flex flex-col gap-2 border-border border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
								<span>Zeilen pro Seite</span>
								<NativeSelect
									className="w-[80px]"
									onChange={(event) => {
										setPagination((prev) => ({
											...prev,
											pageSize: Number(event.target.value),
											pageIndex: 0,
										}));
									}}
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
							<div className="flex items-center gap-2">
								<span className="text-[11px] text-muted-foreground">
									{startRow}-{endRow} von {totalUsers}
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
			</div>
		</div>
	);
}
