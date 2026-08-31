import { redirect } from "next/navigation";

import { ServiceHealthDashboard } from "~/components/service-health-dashboard";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

function defaultRange() {
	const end = new Date();
	const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
	return { start: start.toISOString(), end: end.toISOString() };
}

function validDate(value: string | undefined) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export default async function ServiceHealthPage({
	searchParams,
}: {
	searchParams?: Promise<{ start?: string; end?: string }>;
}) {
	if (!(await auth())?.user) redirect("/");
	const params = await searchParams;
	const defaults = defaultRange();
	const start = validDate(params?.start) ?? defaults.start;
	const end = validDate(params?.end) ?? defaults.end;
	const dashboard = await api.serviceHealth.getDashboard({ start, end });
	return (
		<ServiceHealthDashboard dashboard={dashboard} end={end} start={start} />
	);
}
