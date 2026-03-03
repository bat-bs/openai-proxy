import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { redirect } from "next/navigation";

import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { ThemeProvider } from "~/components/theme-provider";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { auth } from "~/server/auth";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "RobadsAI API-Proxy Verwaltung",
	description: "Verwaltung und Auswertung der API-Proxy-Nutzung.",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default async function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const session = await auth();
	if (!session?.user) {
		redirect("/api/auth/signin");
	}
	return (
		<html className={`${geist.variable}`} lang="de" suppressHydrationWarning>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					<TRPCReactProvider>
						<TooltipProvider>
							<SidebarProvider>
								<Toaster />
								<AppSidebar />
								<SidebarInset>
									<SiteHeader />
									{children}
								</SidebarInset>
							</SidebarProvider>
						</TooltipProvider>
					</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
