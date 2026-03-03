"use client";

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
	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(10);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when users change.
	useEffect(() => {
		setPageIndex(0);
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

	const totalUsers = stats.users.length;
	const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
	const clampedPageIndex = Math.min(pageIndex, totalPages - 1);
	const startRow = totalUsers === 0 ? 0 : clampedPageIndex * pageSize + 1;
	const endRow = Math.min(totalUsers, (clampedPageIndex + 1) * pageSize);
	const pagedUsers = useMemo(() => {
		const start = clampedPageIndex * pageSize;
		return stats.users.slice(start, start + pageSize);
	}, [clampedPageIndex, pageSize, stats.users]);

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
								<TableRow className="border-border text-left text-[11px] text-muted-foreground uppercase tracking-wide">
									<TableHead className="pr-3 pb-2 font-medium">
										Benutzername
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										Input-Tokens
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										Cache-Tokens
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										Output-Tokens
									</TableHead>
									<TableHead className="pb-2 font-medium">
										Letzte Aktivität
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pagedUsers.map((user) => (
									<TableRow
										className="border-border/60 last:border-0"
										key={user.id}
									>
										<TableCell className="py-2 pr-3 font-medium">
											{user.name}
										</TableCell>
										<TableCell className="py-2 pr-3">
											{numberFormatter.format(user.inputTokens)}
										</TableCell>
										<TableCell className="py-2 pr-3">
											{numberFormatter.format(user.cachedTokens)}
										</TableCell>
										<TableCell className="py-2 pr-3">
											{numberFormatter.format(user.outputTokens)}
										</TableCell>
										<TableCell className="py-2">
											{user.lastActivity
												? dateFormatter.format(new Date(user.lastActivity))
												: "—"}
										</TableCell>
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
										setPageSize(Number(event.target.value));
										setPageIndex(0);
									}}
									size="sm"
									value={String(pageSize)}
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
										disabled={clampedPageIndex === 0}
										onClick={() => setPageIndex(0)}
										size="sm"
										variant="outline"
									>
										Erste
									</Button>
									<Button
										disabled={clampedPageIndex === 0}
										onClick={() =>
											setPageIndex((prev) => Math.max(0, prev - 1))
										}
										size="sm"
										variant="outline"
									>
										Zurück
									</Button>
									<Button
										disabled={clampedPageIndex >= totalPages - 1}
										onClick={() =>
											setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))
										}
										size="sm"
										variant="outline"
									>
										Weiter
									</Button>
									<Button
										disabled={clampedPageIndex >= totalPages - 1}
										onClick={() => setPageIndex(totalPages - 1)}
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
