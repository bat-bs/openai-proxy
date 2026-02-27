import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup, SidebarGroupContent,
    SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "~/components/ui/sidebar"
import {KeyRound, User2} from "lucide-react";
import Link from "next/link";

export function AppSidebar() {
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
        </Sidebar>
    )
}