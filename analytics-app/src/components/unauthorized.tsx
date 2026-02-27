import Link from "next/link"

import { Button } from "~/components/ui/button"

export function Unauthorized() {
    return (
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
            <h1 className="text-2xl font-semibold">Unauthorized</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Please log in to access this page.
            </p>
            <div className="mt-4">
                <Button asChild size="sm">
                    <Link href="/api/auth/signin">Log in</Link>
                </Button>
            </div>
        </div>
    )
}
