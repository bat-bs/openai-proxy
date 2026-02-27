import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup, SidebarGroupContent,
    SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "~/components/ui/sidebar"
import {KeyRound, User2} from "lucide-react";
import Link from "next/link";
import {auth} from "~/server/auth";

export async function AppSidebar() {
    const session = await auth();

    return (
        <Sidebar variant="floating">
            <SidebarHeader>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent className="flex flex-col gap-2">
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <Link href="/my-api-keys">
                                    <SidebarMenuButton tooltip={"Test"}>
                                        <KeyRound />
                                        <span>Meine API-Schlüssel</span>
                                    </SidebarMenuButton>
                                </Link>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <Link
                    className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
                    href={session ? "/api/auth/signout" : "/api/auth/signin"}
                >
                    {session ? "Sign out" : "Sign in"}
                </Link>
            </SidebarFooter>
        </Sidebar>
    )
}