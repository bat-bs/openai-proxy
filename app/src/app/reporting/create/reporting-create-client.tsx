"use client";

import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Pie, PieChart } from "recharts";

import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
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
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { api } from "~/trpc/react";

const chartColors = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

type Timeframe = "daily" | "monthly" | "quarterly" | "yearly";

type SortKey =
	| "name"
	| "inputTokens"
	| "cachedInputTokens"
	| "outputTokens"
	| "totalCost";

type SortState = { id: SortKey; direction: "asc" | "desc" } | null;

const timeframeOptions = [
	{ value: "daily", label: "Täglich" },
	{ value: "monthly", label: "Monatlich" },
	{ value: "quarterly", label: "Quartal" },
	{ value: "yearly", label: "Jährlich" },
] as const;

const pad = (value: number) => String(value).padStart(2, "0");

export function ReportingCreateClient({ isAdmin }: { isAdmin: boolean }) {
	const { data: groups = [], isLoading: groupsLoading } =
		api.reporting.listGroups.useQuery();

	const now = useMemo(() => new Date(), []);
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;
	const currentDay = now.getDate();
	const currentQuarter = Math.floor((now.getMonth() + 3) / 3);

	const [timeframe, setTimeframe] = useState<Timeframe>("monthly");
	const [dailyDate, setDailyDate] = useState(
		`${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`,
	);
	const [monthValue, setMonthValue] = useState(
		`${currentYear}-${pad(currentMonth)}`,
	);
	const [quarterYear, setQuarterYear] = useState(currentYear);
	const [quarterValue, setQuarterValue] = useState(currentQuarter);
	const [yearValue, setYearValue] = useState(currentYear);

	const availableGroups = useMemo(() => {
		const list = groups.map((group) => ({
			id: group.id,
			title: group.title,
		}));
		return isAdmin ? [{ id: "all", title: "Alle" }, ...list] : list;
	}, [groups, isAdmin]);

	const [selectedGroupId, setSelectedGroupId] = useState<string>("");

	useEffect(() => {
		if (selectedGroupId) return;
		if (isAdmin) {
			setSelectedGroupId("all");
			return;
		}
		if (availableGroups.length) {
			setSelectedGroupId(availableGroups[0]?.id ?? "");
		}
	}, [availableGroups, isAdmin, selectedGroupId]);

	const reportRange = useMemo(() => {
		switch (timeframe) {
			case "daily":
				return { type: "daily" as const, date: dailyDate };
			case "monthly":
				return { type: "monthly" as const, month: monthValue };
			case "quarterly":
				return {
					type: "quarterly" as const,
					year: Number(quarterYear),
					quarter: Number(quarterValue),
				};
			case "yearly":
				return { type: "yearly" as const, year: Number(yearValue) };
			default:
				return { type: "monthly" as const, month: monthValue };
		}
	}, [dailyDate, monthValue, quarterValue, quarterYear, timeframe, yearValue]);

	const reportEnabled = Boolean(selectedGroupId);
	const { data: report, isLoading: reportLoading } =
		api.reporting.getReport.useQuery(
			{
				groupId: selectedGroupId,
				range: reportRange,
			},
			{
				enabled: reportEnabled && (isAdmin || groups.length > 0),
			},
		);

	const numberFormatter = useMemo(() => new Intl.NumberFormat("de-DE"), []);
	const costFormatter = useMemo(
		() =>
			new Intl.NumberFormat("de-DE", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}),
		[],
	);

	const formatCost = (value: number | null, currency: string | null) => {
		if (value === null || Number.isNaN(value)) return "—";
		const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
		return `${costFormatter.format(value)}${symbol}`;
	};

	const summary = report?.summary;
	const modelUsage = report?.modelUsage ?? [];
	const users = report?.users ?? [];

	const [sorting, setSorting] = useState<SortState>(null);

	const sortedUsers = useMemo(() => {
		if (!sorting) return users;
		const sorted = [...users];
		const direction = sorting.direction === "asc" ? 1 : -1;
		sorted.sort((a, b) => {
			switch (sorting.id) {
				case "name":
					return direction * a.name.localeCompare(b.name);
				case "inputTokens":
					return direction * (a.inputTokens - b.inputTokens);
				case "cachedInputTokens":
					return direction * (a.cachedInputTokens - b.cachedInputTokens);
				case "outputTokens":
					return direction * (a.outputTokens - b.outputTokens);
				case "totalCost":
					return direction * ((a.totalCost ?? -1) - (b.totalCost ?? -1));
				default:
					return 0;
			}
		});
		return sorted;
	}, [sorting, users]);

	const toggleSorting = (id: SortKey) => {
		setSorting((prev) => {
			if (!prev || prev.id !== id) {
				return { id, direction: "asc" };
			}
			return prev.direction === "asc" ? { id, direction: "desc" } : null;
		});
	};

	const chartData = modelUsage.map((item, index) => {
		const key = `model-${index}`;
		return {
			key,
			model: item.model,
			outputTokens: item.outputTokens,
			fill: `var(--color-${key})`,
		};
	});

	const chartConfig = chartData.reduce<ChartConfig>((acc, item, index) => {
		acc[item.key] = {
			label: item.model,
			color: chartColors[index % chartColors.length],
		};
		return acc;
	}, {});

	if (!isAdmin && !groupsLoading && availableGroups.length === 0) {
		return (
			<div className="rounded-none border border-border bg-card p-6 text-muted-foreground text-sm">
				Du bist für keine Abrechnungsgruppe berechtigt, sie einzusehen.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="rounded-none border border-border bg-card p-5">
				<div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
					<div>
						<label
							className="font-medium text-muted-foreground text-xs"
							htmlFor="reporting-group"
						>
							Abrechnungsgruppe
						</label>
						<div className="mt-2">
							<NativeSelect
								id="reporting-group"
								onChange={(event) => setSelectedGroupId(event.target.value)}
								value={selectedGroupId}
							>
								{availableGroups.map((group) => (
									<NativeSelectOption key={group.id} value={group.id}>
										{group.title}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
					</div>
					<div>
						<div className="font-medium text-muted-foreground text-xs">
							Zeitraum
						</div>
						<Tabs
							onValueChange={(value) => setTimeframe(value as Timeframe)}
							value={timeframe}
						>
							<TabsList variant="line">
								{timeframeOptions.map((option) => (
									<TabsTrigger key={option.value} value={option.value}>
										{option.label}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
						<div className="mt-3 flex flex-wrap gap-3">
							{timeframe === "daily" ? (
								<Input
									onChange={(event) => setDailyDate(event.target.value)}
									type="date"
									value={dailyDate}
								/>
							) : null}
							{timeframe === "monthly" ? (
								<Input
									onChange={(event) => setMonthValue(event.target.value)}
									type="month"
									value={monthValue}
								/>
							) : null}
							{timeframe === "quarterly" ? (
								<>
									<NativeSelect
										className="w-[120px]"
										onChange={(event) =>
											setQuarterValue(Number(event.target.value))
										}
										value={String(quarterValue)}
									>
										{[1, 2, 3, 4].map((quarter) => (
											<NativeSelectOption key={quarter} value={String(quarter)}>
												Q{quarter}
											</NativeSelectOption>
										))}
									</NativeSelect>
									<Input
										max={2200}
										min={2000}
										onChange={(event) =>
											setQuarterYear(Number(event.target.value))
										}
										type="number"
										value={quarterYear}
									/>
								</>
							) : null}
							{timeframe === "yearly" ? (
								<Input
									max={2200}
									min={2000}
									onChange={(event) => setYearValue(Number(event.target.value))}
									type="number"
									value={yearValue}
								/>
							) : null}
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-none border border-border bg-card p-6">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="text-muted-foreground text-xs uppercase tracking-wide">
							Token-Übersicht
						</div>
						<div className="mt-2 flex flex-wrap gap-4 text-sm">
							<div>
								<span className="text-muted-foreground">Input:</span>{" "}
								<span className="font-semibold">
									{numberFormatter.format(summary?.inputTokens ?? 0)}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground">Cache:</span>{" "}
								<span className="font-semibold">
									{numberFormatter.format(summary?.cachedInputTokens ?? 0)}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground">Output:</span>{" "}
								<span className="font-semibold">
									{numberFormatter.format(summary?.outputTokens ?? 0)}
								</span>
							</div>
						</div>
					</div>
					<div className="text-right">
						<div className="text-muted-foreground text-xs uppercase tracking-wide">
							Gesamtkosten
						</div>
						<div className="mt-2 font-semibold text-2xl">
							{formatCost(
								summary?.totalCost ?? null,
								summary?.currency ?? "EUR",
							)}
						</div>
					</div>
				</div>
				{reportLoading ? (
					<div className="mt-3 text-muted-foreground text-xs">
						Bericht wird geladen ...
					</div>
				) : null}
			</div>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="rounded-none border border-border bg-card p-4">
					<div className="font-medium text-muted-foreground text-xs">
						Modelle nach Output-Tokens
					</div>
					<div className="mt-4">
						{chartData.length ? (
							<ChartContainer className="h-72" config={chartConfig}>
								<PieChart>
									<ChartTooltip
										content={<ChartTooltipContent nameKey="key" />}
									/>
									<Pie
										data={chartData}
										dataKey="outputTokens"
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
								Keine Modelle im ausgewählten Zeitraum.
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
										<SortButton
											active={sorting?.id === "name" ? sorting.direction : null}
											onClick={() => toggleSorting("name")}
										>
											Benutzer / Modell
										</SortButton>
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										<SortButton
											active={
												sorting?.id === "inputTokens" ? sorting.direction : null
											}
											onClick={() => toggleSorting("inputTokens")}
										>
											Input-Tokens
										</SortButton>
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										<SortButton
											active={
												sorting?.id === "cachedInputTokens"
													? sorting.direction
													: null
											}
											onClick={() => toggleSorting("cachedInputTokens")}
										>
											Cache-Tokens
										</SortButton>
									</TableHead>
									<TableHead className="pr-3 pb-2 font-medium">
										<SortButton
											active={
												sorting?.id === "outputTokens"
													? sorting.direction
													: null
											}
											onClick={() => toggleSorting("outputTokens")}
										>
											Output-Tokens
										</SortButton>
									</TableHead>
									<TableHead className="pr-3 pb-2 text-right font-medium">
										<SortButton
											active={
												sorting?.id === "totalCost" ? sorting.direction : null
											}
											onClick={() => toggleSorting("totalCost")}
										>
											Gesamtkosten
										</SortButton>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{sortedUsers.map((user) => (
									<Fragment key={user.id}>
										<TableRow className="border-border/60">
											<TableCell className="py-2 pr-3 font-medium">
												{user.name}
											</TableCell>
											<TableCell className="py-2 pr-3">
												{numberFormatter.format(user.inputTokens)}
											</TableCell>
											<TableCell className="py-2 pr-3">
												{numberFormatter.format(user.cachedInputTokens)}
											</TableCell>
											<TableCell className="py-2 pr-3">
												{numberFormatter.format(user.outputTokens)}
											</TableCell>
											<TableCell className="py-2 pr-3 text-right">
												{formatCost(user.totalCost, user.currency)}
											</TableCell>
										</TableRow>
										{user.models.map((model) => (
											<TableRow
												className="border-border/40 text-muted-foreground"
												key={`${user.id}-${model.model}`}
											>
												<TableCell className="py-1.5 pr-3 pl-6">
													↳ {model.model}
												</TableCell>
												<TableCell className="py-1.5 pr-3">
													{numberFormatter.format(model.inputTokens)} (
													{formatCost(model.inputCost, model.currency)})
												</TableCell>
												<TableCell className="py-1.5 pr-3">
													{numberFormatter.format(model.cachedInputTokens)} (
													{formatCost(model.cachedCost, model.currency)})
												</TableCell>
												<TableCell className="py-1.5 pr-3">
													{numberFormatter.format(model.outputTokens)} (
													{formatCost(model.outputCost, model.currency)})
												</TableCell>
												<TableCell className="py-1.5 pr-3 text-right">
													{formatCost(model.totalCost, model.currency)}
												</TableCell>
											</TableRow>
										))}
									</Fragment>
								))}
								{sortedUsers.length === 0 ? (
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
					</div>
				</div>
			</div>
		</div>
	);
}

function SortButton({
	children,
	active,
	onClick,
}: {
	children: React.ReactNode;
	active: "asc" | "desc" | null;
	onClick: () => void;
}) {
	return (
		<button
			className="inline-flex items-center gap-1"
			onClick={onClick}
			type="button"
		>
			{children}
			{active === "asc" ? (
				<ChevronUp className="h-3 w-3" />
			) : active === "desc" ? (
				<ChevronDown className="h-3 w-3" />
			) : (
				<ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
			)}
		</button>
	);
}
