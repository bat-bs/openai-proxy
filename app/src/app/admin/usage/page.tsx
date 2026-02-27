import { redirect } from "next/navigation"

import { AdminUsageDashboard } from "~/components/admin-usage-dashboard"
import { auth } from "~/server/auth"
import { api } from "~/trpc/server"

const validRanges = new Set(["24h", "7d", "30d", "all"])

export default async function AdminUsagePage({
	searchParams,
}: {
	searchParams?: Promise<{ range?: string }>
}) {
	const resolvedSearchParams = await searchParams
	const session = await auth()
	if (!session?.user?.isAdmin) {
		redirect("/")
	}

	const range = validRanges.has(resolvedSearchParams?.range ?? "")
		? (resolvedSearchParams?.range as "24h" | "7d" | "30d" | "all")
		: "24h"

	const stats = await api.admin.getUsageStats({ range })

	return <AdminUsageDashboard range={range} stats={stats} />
}
