import { LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SidebarNav } from "~/components/sidebar-nav";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "~/components/ui/sidebar";
import { auth } from "~/server/auth";

export async function AppSidebar() {
	const session = await auth();

	return (
		<Sidebar variant="inset">
			<SidebarHeader></SidebarHeader>
			<SidebarContent>
				<SidebarNav isAdmin={session?.user?.isAdmin ?? false} />
			</SidebarContent>
			<SidebarFooter>
				{session?.user ? (
					<details className="group relative w-full">
						<summary className="flex w-full cursor-pointer list-none items-center gap-2 rounded-none p-2 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
							{session.user.image ? (
								<Image
									alt=""
									className="h-6 w-6 rounded-full object-cover"
									height={24}
									referrerPolicy="no-referrer"
									src={session.user.image}
									unoptimized
									width={24}
								/>
							) : (
								<div className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent font-medium text-[10px] text-sidebar-accent-foreground">
									{(session.user.name ?? "U").slice(0, 1).toUpperCase()}
								</div>
							)}
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-xs">
									{session.user.name ?? "Benutzer"}
								</div>
								{session.user.email ? (
									<div className="truncate text-[10px] text-muted-foreground">
										{session.user.email}
									</div>
								) : null}
							</div>
						</summary>
						<div className="absolute right-2 bottom-12 left-2 z-10 rounded-none border border-border bg-popover p-1 text-xs shadow-sm">
							<Link
								className="flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left hover:bg-muted"
								href="/api/auth/signout"
							>
								<LogOut className="h-4 w-4" />
								<span>Abmelden</span>
							</Link>
						</div>
					</details>
				) : (
					<Link
						className="w-full rounded-none p-2 text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
						href="/api/auth/signin"
					>
						Anmelden
					</Link>
				)}
			</SidebarFooter>
		</Sidebar>
	);
}
