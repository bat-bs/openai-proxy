"use client";

import { BarChart3, Coins, FileText, KeyRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";

const userItems = [
	{
		href: "/my-api-keys",
		label: "Meine API-Schlüssel",
		icon: KeyRound,
	},
];

const adminItems = [
	{
		href: "/admin/usage",
		label: "Nutzungsstatistiken",
		icon: BarChart3,
	},
	{
		href: "/admin/costs",
		label: "Kosten",
		icon: Coins,
	},
];

const reportingItems = [
	{
		href: "/reporting/create",
		label: "Bericht erstellen",
		icon: FileText,
	},
	{
		href: "/reporting/groups",
		label: "Abrechnungsgruppen",
		icon: Users,
		adminOnly: true,
	},
];

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
	const pathname = usePathname();

	return (
		<>
			<SidebarGroup>
				<SidebarGroupLabel>Meine Daten</SidebarGroupLabel>
				<SidebarGroupContent className="flex flex-col gap-2">
					<SidebarMenu>
						{userItems.map((item) => {
							const isActive = pathname === item.href;
							const Icon = item.icon;
							return (
								<SidebarMenuItem key={item.href}>
									<Link
										aria-current={isActive ? "page" : undefined}
										href={item.href}
									>
										<SidebarMenuButton isActive={isActive} tooltip={item.label}>
											<Icon />
											<span>{item.label}</span>
										</SidebarMenuButton>
									</Link>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
			{isAdmin ? (
				<SidebarGroup>
					<SidebarGroupLabel>Admin</SidebarGroupLabel>
					<SidebarGroupContent className="flex flex-col gap-2">
						<SidebarMenu>
							{adminItems.map((item) => {
								const isActive = pathname === item.href;
								const Icon = item.icon;
								return (
									<SidebarMenuItem key={item.href}>
										<Link
											aria-current={isActive ? "page" : undefined}
											href={item.href}
										>
											<SidebarMenuButton
												isActive={isActive}
												tooltip={item.label}
											>
												<Icon />
												<span>{item.label}</span>
											</SidebarMenuButton>
										</Link>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			) : null}
			<SidebarGroup>
				<SidebarGroupLabel>Reporting</SidebarGroupLabel>
				<SidebarGroupContent className="flex flex-col gap-2">
					<SidebarMenu>
						{reportingItems
							.filter((item) => !item.adminOnly || isAdmin)
							.map((item) => {
								const isActive = pathname === item.href;
								const Icon = item.icon;
								return (
									<SidebarMenuItem key={item.href}>
										<Link
											aria-current={isActive ? "page" : undefined}
											href={item.href}
										>
											<SidebarMenuButton
												isActive={isActive}
												tooltip={item.label}
											>
												<Icon />
												<span>{item.label}</span>
											</SidebarMenuButton>
										</Link>
									</SidebarMenuItem>
								);
							})}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</>
	);
}
