import Link from "next/link"

import { buttonVariants } from "~/components/ui/button"

export function Unauthorized() {
    return (
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
            <h1 className="text-2xl font-semibold">Unauthorized</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Please log in to access this page.
            </p>
            <div className="mt-4">
                <Link
                    href="/api/auth/signin"
                    className={buttonVariants({ size: "sm" })}
                >
                    Log in
                </Link>
            </div>
        </div>
    )
}
