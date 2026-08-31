import { redirect } from "next/navigation";

import { ServiceHealthSettings } from "~/components/service-health-settings";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function ServiceHealthSettingsPage() {
	if (!(await auth())?.user?.isAdmin) redirect("/");
	const settings = await api.serviceHealth.getSettings();
	return <ServiceHealthSettings value={settings.value} />;
}
