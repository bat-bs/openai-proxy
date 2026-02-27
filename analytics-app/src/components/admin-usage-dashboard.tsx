"use client"

import { Pie, PieChart } from "recharts"
import { useRouter } from "next/navigation"

import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"

type UsageModel = {
    model: string
    tokens: number
}

type UsageUser = {
    id: string
    name: string
    inputTokens: number
    cachedTokens: number
    outputTokens: number
    lastActivity: string | null
}

type UsageStats = {
    totalTokens: number
    modelUsage: UsageModel[]
    users: UsageUser[]
}

const ranges = [
    { value: "24h", label: "24 Stunden" },
    { value: "7d", label: "7 Tage" },
    { value: "30d", label: "30 Tage" },
    { value: "all", label: "Allzeit" },
] as const

const chartColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
]

export function AdminUsageDashboard({
    range,
    stats,
}: {
    range: (typeof ranges)[number]["value"]
    stats: UsageStats
}) {
    const router = useRouter()
    const numberFormatter = new Intl.NumberFormat("de-DE")
    const dateFormatter = new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
    })

    const pieData = stats.modelUsage.map((item, index) => {
        const key = `model-${index}`
        return {
            key,
            model: item.model,
            tokens: item.tokens,
            fill: `var(--color-${key})`,
        }
    })

    const chartConfig = pieData.reduce<ChartConfig>((acc, item, index) => {
        acc[item.key] = {
            label: item.model,
            color: chartColors[index % chartColors.length],
        }
        return acc
    }, {})

    return (
        <div className="mx-auto w-full max-w-6xl px-6 py-10">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-semibold">Nutzungsstatistiken</h1>
                    <Tabs
                        value={range}
                        onValueChange={(value) => router.push(`/admin/usage?range=${value}`)}
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
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Tokens used
                    </div>
                    <div className="mt-2 text-3xl font-semibold">
                        Tokens used: {numberFormatter.format(stats.totalTokens)}
                    </div>
                </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-none border border-border bg-card p-4">
                    <div className="text-xs font-medium text-muted-foreground">
                        Usage distribution by model
                    </div>
                    <div className="mt-4">
                        {pieData.length ? (
                            <ChartContainer config={chartConfig} className="h-72">
                                <PieChart>
                                    <ChartTooltip
                                        content={<ChartTooltipContent nameKey="key" />}
                                    />
                                    <Pie
                                        data={pieData}
                                        dataKey="tokens"
                                        nameKey="key"
                                        innerRadius={60}
                                        stroke="var(--background)"
                                        strokeWidth={2}
                                    />
                                    <ChartLegend
                                        content={<ChartLegendContent nameKey="key" />}
                                    />
                                </PieChart>
                            </ChartContainer>
                        ) : (
                            <div className="text-xs text-muted-foreground">
                                No usage data for this period.
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-none border border-border bg-card p-4">
                    <div className="text-xs font-medium text-muted-foreground">
                        Usage by user
                    </div>
                    <div className="mt-4 overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <th className="pb-2 pr-3 font-medium">Username</th>
                                    <th className="pb-2 pr-3 font-medium">Input tokens</th>
                                    <th className="pb-2 pr-3 font-medium">Cached tokens</th>
                                    <th className="pb-2 pr-3 font-medium">Output tokens</th>
                                    <th className="pb-2 font-medium">Last activity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.users.map((user) => (
                                    <tr
                                        key={user.id}
                                        className="border-b border-border/60 last:border-0"
                                    >
                                        <td className="py-2 pr-3 font-medium">
                                            {user.name}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {numberFormatter.format(user.inputTokens)}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {numberFormatter.format(user.cachedTokens)}
                                        </td>
                                        <td className="py-2 pr-3">
                                            {numberFormatter.format(user.outputTokens)}
                                        </td>
                                        <td className="py-2">
                                            {user.lastActivity
                                                ? dateFormatter.format(new Date(user.lastActivity))
                                                : "—"}
                                        </td>
                                    </tr>
                                ))}
                                {!stats.users.length ? (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="py-4 text-center text-muted-foreground"
                                        >
                                            No users found.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
