import { redirect } from "next/navigation"

import { auth } from "~/server/auth"
import { CostsClient } from "./costs-client"

export default async function AdminCostsPage() {
	const session = await auth()
	if (!session?.user?.isAdmin) {
		redirect("/")
	}

	return <CostsClient />
}
