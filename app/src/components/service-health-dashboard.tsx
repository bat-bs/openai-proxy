"use client";

import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock3,
	XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "~/components/ui/chart";
import { Input } from "~/components/ui/input";

type Latency = {
	averageMs: number | null;
	p50Ms: number | null;
	p95Ms: number | null;
	maximumMs: number | null;
};

type Dashboard = {
	range: { start: string; end: string; bucketSeconds: number };
	totals: {
		total: number;
		successful: number;
		redirects: number;
		clientErrors: number;
		serverErrors: number;
		timeouts: number;
		upstreamCancellations: number;
		transportErrors: number;
		callerCancellations: number;
		unsuccessful: number;
		failureRate: number;
	};
	latency: { duration: Latency; firstByte: Latency };
	statusCodes: {
		statusCode: number | null;
		outcome: string;
		count: number;
	}[];
	providers: {
		provider: string;
		count: number;
		unsuccessful: number;
		avgDurationMs: number;
	}[];
	endpoints: { endpoint: string; count: number; unsuccessful: number }[];
	models: { model: string; count: number; unsuccessful: number }[];
	timeline: {
		bucket: string;
		total: number;
		successful: number;
		unsuccessful: number;
		callerCancellations: number;
		avgDurationMs: number | null;
		p95DurationMs: number | null;
	}[];
};

function localInputValue(iso: string, timeZone: string) {
	const date = new Date(iso);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "00";
	return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function toISO(value: string) {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatBucket(seconds: number) {
	if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)} Std.`;
	return `${Math.round(seconds / 3600)} Std.`;
}

function formatLatency(value: number | null, number: Intl.NumberFormat) {
	return value === null ? "No data" : `${number.format(Math.round(value))} ms`;
}

export function ServiceHealthDashboard({
	dashboard,
	start,
	end,
}: {
	dashboard: Dashboard;
	start: string;
	end: string;
}) {
	const router = useRouter();
	const [displayLocale, setDisplayLocale] = useState("en-US");
	const [displayTimeZone, setDisplayTimeZone] = useState("UTC");
	const [localStart, setLocalStart] = useState(localInputValue(start, "UTC"));
	const [localEnd, setLocalEnd] = useState(localInputValue(end, "UTC"));
	const [customRangeError, setCustomRangeError] = useState<string | null>(null);
	useEffect(() => {
		const resolved = Intl.DateTimeFormat().resolvedOptions();
		const locale = resolved.locale || "en-US";
		const timeZone = resolved.timeZone || "UTC";
		setDisplayLocale(locale);
		setDisplayTimeZone(timeZone);
		setLocalStart(localInputValue(start, timeZone));
		setLocalEnd(localInputValue(end, timeZone));
	}, [start, end]);
	const number = new Intl.NumberFormat(displayLocale);
	const date = new Intl.DateTimeFormat(displayLocale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: displayTimeZone,
	});

	const navigate = (nextStart: Date, nextEnd: Date) => {
		router.push(
			`/service-health?start=${encodeURIComponent(nextStart.toISOString())}&end=${encodeURIComponent(nextEnd.toISOString())}`,
		);
	};
	const applyCustomRange = () => {
		const nextStart = toISO(localStart);
		const nextEnd = toISO(localEnd);
		if (!nextStart || !nextEnd) {
			setCustomRangeError("Bitte gib einen gültigen Zeitraum ein.");
			return;
		}
		if (nextStart >= nextEnd) {
			setCustomRangeError("Das Ende muss nach dem Beginn liegen.");
			return;
		}
		setCustomRangeError(null);
		navigate(new Date(nextStart), new Date(nextEnd));
	};
	const preset = (minutes: number) => {
		const nextEnd = new Date();
		navigate(new Date(nextEnd.getTime() - minutes * 60 * 1000), nextEnd);
	};

	return (
		<main className="mx-auto w-full max-w-7xl px-6 py-10">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl">Service Health</h1>
					<p className="text-muted-foreground text-sm">
						Aggregierte Upstream-Metriken. Zeitangaben werden lokal angezeigt.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button onClick={() => preset(5)} size="sm" variant="outline">
						5 Min.
					</Button>
					<Button onClick={() => preset(15)} size="sm" variant="outline">
						15 Min.
					</Button>
					<Button onClick={() => preset(30)} size="sm" variant="outline">
						30 Min.
					</Button>
					<Button onClick={() => preset(60)} size="sm" variant="outline">
						1 Std.
					</Button>
					<Button onClick={() => preset(24 * 60)} size="sm" variant="outline">
						24 Std.
					</Button>
					<Button
						onClick={() => preset(24 * 7 * 60)}
						size="sm"
						variant="outline"
					>
						7 Tage
					</Button>
					<Button
						onClick={() => preset(24 * 30 * 60)}
						size="sm"
						variant="outline"
					>
						30 Tage
					</Button>
				</div>
			</div>
			<Card className="mt-5">
				<CardContent className="flex flex-wrap items-end gap-3 pt-6">
					<label className="grid gap-1 text-sm" htmlFor="health-start">
						Von
						<Input
							id="health-start"
							onChange={(event) => {
								setCustomRangeError(null);
								setLocalStart(event.target.value);
							}}
							type="datetime-local"
							value={localStart}
						/>
					</label>
					<label className="grid gap-1 text-sm" htmlFor="health-end">
						Bis
						<Input
							id="health-end"
							onChange={(event) => {
								setCustomRangeError(null);
								setLocalEnd(event.target.value);
							}}
							type="datetime-local"
							value={localEnd}
						/>
					</label>
					<Button onClick={applyCustomRange}>Zeitraum anwenden</Button>
					{customRangeError ? (
						<span className="text-destructive text-xs" role="alert">
							{customRangeError}
						</span>
					) : null}
					<span className="text-muted-foreground text-xs">
						Buckets: {formatBucket(dashboard.range.bucketSeconds)}
					</span>
				</CardContent>
			</Card>

			<div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<Metric
					icon={<Activity />}
					title="Requests"
					value={number.format(dashboard.totals.total)}
				/>
				<Metric
					icon={<CheckCircle2 />}
					title="2xx erfolgreich"
					value={number.format(dashboard.totals.successful)}
				/>
				<Metric
					icon={<XCircle />}
					title="Unsuccessful"
					value={number.format(dashboard.totals.unsuccessful)}
				/>
				<Metric
					icon={<AlertTriangle />}
					title="Fehlerrate (reine Caller-Abbrüche separat)"
					value={`${dashboard.totals.failureRate.toFixed(1)}%`}
				/>
				<Metric
					icon={<Clock3 />}
					title="p95 Dauer"
					value={formatLatency(dashboard.latency.duration.p95Ms, number)}
				/>
			</div>

			<div className="mt-5 grid gap-5 lg:grid-cols-2">
				<ChartCard title="Requests und Fehler">
					<ChartContainer
						config={{
							total: { label: "Requests", color: "var(--chart-1)" },
							unsuccessful: { label: "Unsuccessful", color: "var(--chart-2)" },
							callerCancellations: {
								label: "Caller cancel",
								color: "var(--chart-3)",
							},
						}}
					>
						<LineChart data={dashboard.timeline}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="bucket"
								tickFormatter={(value) => date.format(new Date(value))}
							/>
							<YAxis allowDecimals={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Line
								dataKey="total"
								dot={false}
								stroke="var(--color-total)"
								strokeWidth={2}
							/>
							<Line
								dataKey="unsuccessful"
								dot={false}
								stroke="var(--color-unsuccessful)"
								strokeWidth={2}
							/>
							<Line
								dataKey="callerCancellations"
								dot={false}
								stroke="var(--color-callerCancellations)"
								strokeWidth={2}
							/>
						</LineChart>
					</ChartContainer>
					<TimelineTable timeline={dashboard.timeline} />
				</ChartCard>
				<ChartCard title="Latenz">
					<ChartContainer
						config={{
							avgDurationMs: { label: "Durchschnitt", color: "var(--chart-1)" },
							p95DurationMs: { label: "p95", color: "var(--chart-2)" },
						}}
					>
						<LineChart data={dashboard.timeline}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="bucket"
								tickFormatter={(value) => date.format(new Date(value))}
							/>
							<YAxis allowDecimals={false} unit=" ms" />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Line
								dataKey="avgDurationMs"
								dot={false}
								stroke="var(--color-avgDurationMs)"
								strokeWidth={2}
							/>
							<Line
								dataKey="p95DurationMs"
								dot={false}
								stroke="var(--color-p95DurationMs)"
								strokeWidth={2}
							/>
						</LineChart>
					</ChartContainer>
					<LatencyTimelineTable timeline={dashboard.timeline} />
				</ChartCard>
				<ChartCard title="HTTP-Statuscodes">
					<ChartContainer
						config={{ count: { label: "Requests", color: "var(--chart-3)" } }}
					>
						<BarChart
							data={dashboard.statusCodes.map((row) => ({
								...row,
								label:
									row.statusCode === null
										? row.outcome
										: String(row.statusCode),
							}))}
						>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" />
							<YAxis allowDecimals={false} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar dataKey="count" fill="var(--color-count)" radius={2} />
						</BarChart>
					</ChartContainer>
					<StatusCodeTable rows={dashboard.statusCodes} />
				</ChartCard>
				<LatencyCard latency={dashboard.latency} number={number} />
			</div>

			<BreakdownCard
				rows={dashboard.providers.map((row) => ({
					label: row.provider,
					count: row.count,
					unsuccessful: row.unsuccessful,
					suffix: `Ø ${Math.round(row.avgDurationMs)} ms`,
				}))}
				title="Provider"
			/>
			<BreakdownCard
				rows={dashboard.endpoints.map((row) => ({
					label: row.endpoint,
					count: row.count,
					unsuccessful: row.unsuccessful,
				}))}
				title="Endpoints"
			/>
			<BreakdownCard
				rows={dashboard.models.map((row) => ({
					label: row.model,
					count: row.count,
					unsuccessful: row.unsuccessful,
				}))}
				title="Modelle"
			/>
		</main>
	);
}

function Metric({
	title,
	value,
	icon,
}: {
	title: string;
	value: string | number;
	icon: React.ReactNode;
}) {
	return (
		<Card>
			<CardContent className="flex items-center justify-between pt-6">
				<div>
					<p className="text-muted-foreground text-sm">{title}</p>
					<p className="mt-1 font-semibold text-2xl">{value}</p>
				</div>
				<span className="text-muted-foreground">{icon}</span>
			</CardContent>
		</Card>
	);
}

function ChartCard({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

function LatencyCard({
	latency,
	number,
}: {
	latency: { duration: Latency; firstByte: Latency };
	number: Intl.NumberFormat;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Latency-Zusammenfassung</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm sm:grid-cols-2">
				<LatencyGroup
					label="Gesamtdauer"
					latency={latency.duration}
					number={number}
				/>
				<LatencyGroup
					label="First byte"
					latency={latency.firstByte}
					number={number}
				/>
			</CardContent>
		</Card>
	);
}

function TimelineTable({ timeline }: { timeline: Dashboard["timeline"] }) {
	return (
		<table className="sr-only">
			<caption>Requests und Fehler pro Zeitintervall</caption>
			<thead>
				<tr>
					<th scope="col">Zeit</th>
					<th scope="col">Requests</th>
					<th scope="col">Unsuccessful</th>
					<th scope="col">Caller cancel</th>
				</tr>
			</thead>
			<tbody>
				{timeline.map((row) => (
					<tr key={row.bucket}>
						<th scope="row">{new Date(row.bucket).toISOString()}</th>
						<td>{row.total}</td>
						<td>{row.unsuccessful}</td>
						<td>{row.callerCancellations}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function LatencyTimelineTable({
	timeline,
}: {
	timeline: Dashboard["timeline"];
}) {
	return (
		<table className="sr-only">
			<caption>Durchschnittliche und p95-Latenz pro Zeitintervall</caption>
			<thead>
				<tr>
					<th scope="col">Zeit</th>
					<th scope="col">Durchschnitt in Millisekunden</th>
					<th scope="col">p95 in Millisekunden</th>
				</tr>
			</thead>
			<tbody>
				{timeline.map((row) => (
					<tr key={row.bucket}>
						<th scope="row">{new Date(row.bucket).toISOString()}</th>
						<td>{row.avgDurationMs ?? "Keine Daten"}</td>
						<td>{row.p95DurationMs ?? "Keine Daten"}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function StatusCodeTable({ rows }: { rows: Dashboard["statusCodes"] }) {
	return (
		<table className="sr-only">
			<caption>Requests nach HTTP-Statuscode</caption>
			<thead>
				<tr>
					<th scope="col">Statuscode oder Ergebnis</th>
					<th scope="col">Requests</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={`${row.statusCode ?? "outcome"}-${row.outcome}`}>
						<th scope="row">{row.statusCode ?? row.outcome}</th>
						<td>{row.count}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function LatencyGroup({
	label,
	latency,
	number,
}: {
	label: string;
	latency: Latency;
	number: Intl.NumberFormat;
}) {
	const format = (value: number | null) => formatLatency(value, number);
	return (
		<div>
			<p className="font-medium">{label}</p>
			<dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
				<dt>Ø</dt>
				<dd>{format(latency.averageMs)}</dd>
				<dt>p50</dt>
				<dd>{format(latency.p50Ms)}</dd>
				<dt>p95</dt>
				<dd>{format(latency.p95Ms)}</dd>
				<dt>Max</dt>
				<dd>{format(latency.maximumMs)}</dd>
			</dl>
		</div>
	);
}

function BreakdownCard({
	title,
	rows,
}: {
	title: string;
	rows: {
		label: string;
		count: number;
		unsuccessful: number;
		suffix?: string;
	}[];
}) {
	return (
		<Card className="mt-5">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="divide-y">
					{rows.length ? (
						rows.map((row) => (
							<div
								className="flex flex-wrap items-center justify-between gap-3 py-3"
								key={row.label}
							>
								<span className="font-medium">{row.label}</span>
								<span className="text-muted-foreground">
									{row.count} Requests · {row.unsuccessful} unsuccessful
									{row.suffix ? ` · ${row.suffix}` : ""}
								</span>
							</div>
						))
					) : (
						<p className="text-muted-foreground">
							Keine Daten im gewählten Zeitraum.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
