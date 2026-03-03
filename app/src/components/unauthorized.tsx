import Link from "next/link";

import { buttonVariants } from "~/components/ui/button";

export function Unauthorized() {
	return (
		<div className="mx-auto w-full max-w-5xl px-6 py-10">
			<h1 className="font-semibold text-2xl">Unauthorized</h1>
			<p className="mt-2 text-muted-foreground text-sm">
				Please log in to access this page.
			</p>
			<div className="mt-4">
				<Link
					className={buttonVariants({ size: "sm" })}
					href="/api/auth/signin"
				>
					Log in
				</Link>
			</div>
		</div>
	);
}
