"use client"

import { useEffect, useMemo, useState } from "react"
import { Pie, PieChart } from "recharts"
import { useRouter } from "next/navigation"

import { Button } from "~/components/ui/button"
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"

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
    const [pageIndex, setPageIndex] = useState(0)
    const [pageSize, setPageSize] = useState(10)

    useEffect(() => {
        setPageIndex(0)
    }, [stats.users.length])

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

    const totalUsers = stats.users.length
    const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize))
    const clampedPageIndex = Math.min(pageIndex, totalPages - 1)
    const startRow = totalUsers === 0 ? 0 : clampedPageIndex * pageSize + 1
    const endRow = Math.min(totalUsers, (clampedPageIndex + 1) * pageSize)
    const pagedUsers = useMemo(() => {
        const start = clampedPageIndex * pageSize
        return stats.users.slice(start, start + pageSize)
    }, [clampedPageIndex, pageSize, stats.users])

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
                    <div className="mt-4">
                        <Table className="border-collapse text-xs">
                            <TableHeader>
                                <TableRow className="border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <TableHead className="pb-2 pr-3 font-medium">
                                        Username
                                    </TableHead>
                                    <TableHead className="pb-2 pr-3 font-medium">
                                        Input tokens
                                    </TableHead>
                                    <TableHead className="pb-2 pr-3 font-medium">
                                        Cached tokens
                                    </TableHead>
                                    <TableHead className="pb-2 pr-3 font-medium">
                                        Output tokens
                                    </TableHead>
                                    <TableHead className="pb-2 font-medium">
                                        Last activity
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedUsers.map((user) => (
                                    <TableRow
                                        key={user.id}
                                        className="border-border/60 last:border-0"
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
                                            colSpan={5}
                                            className="py-4 text-center text-muted-foreground"
                                        >
                                            No users found.
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                            </TableBody>
                        </Table>
                        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>Rows per page</span>
                                <NativeSelect
                                    value={String(pageSize)}
                                    onChange={(event) => {
                                        setPageSize(Number(event.target.value))
                                        setPageIndex(0)
                                    }}
                                    className="w-[80px]"
                                    size="sm"
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
                                    {startRow}-{endRow} of {totalUsers}
                                </span>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPageIndex(0)}
                                        disabled={clampedPageIndex === 0}
                                    >
                                        First
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setPageIndex((prev) => Math.max(0, prev - 1))
                                        }
                                        disabled={clampedPageIndex === 0}
                                    >
                                        Prev
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setPageIndex((prev) =>
                                                Math.min(totalPages - 1, prev + 1)
                                            )
                                        }
                                        disabled={clampedPageIndex >= totalPages - 1}
                                    >
                                        Next
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPageIndex(totalPages - 1)}
                                        disabled={clampedPageIndex >= totalPages - 1}
                                    >
                                        Last
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
