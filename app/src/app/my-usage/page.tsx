import { redirect } from "next/navigation";

import { UsagePage } from "~/components/my-usage-page";
import { auth } from "~/server/auth";

export default async function MyUsagePage() {
	const session = await auth();
	if (!session?.user) redirect("/");

	return <UsagePage />;
}
