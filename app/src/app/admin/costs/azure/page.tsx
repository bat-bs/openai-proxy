import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { AzurePricingClient } from "./pricing-client";

export default async function AzurePricingPage() {
	const session = await auth();
	if (!session?.user?.isAdmin) redirect("/");
	return <AzurePricingClient />;
}
