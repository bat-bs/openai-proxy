"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
export function SiteHeader() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const stored = localStorage.getItem("theme");
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;
		const initial = stored ? stored === "dark" : prefersDark;
		setIsDark(initial);
		document.documentElement.classList.toggle("dark", initial);
	}, []);

	const toggleTheme = () => {
		const next = !isDark;
		setIsDark(next);
		document.documentElement.classList.toggle("dark", next);
		localStorage.setItem("theme", next ? "dark" : "light");
	};

	return (
		<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					className="mx-2 data-[orientation=vertical]:h-8"
					orientation="vertical"
				/>
				<h1 className="font-medium text-base">
					RobadsAI API Proxy Mananagement App
				</h1>
				<div className="ml-auto flex items-center gap-2">
					<Button className="hidden sm:flex" size="sm" variant="ghost">
						<a
							className="dark:text-foreground"
							href="/"
							rel="noopener noreferrer"
							target="_blank"
						>
							API-Keys verwalten
						</a>
					</Button>
					<Button
						aria-label={
							isDark
								? "Zum hellen Modus wechseln"
								: "Zum dunklen Modus wechseln"
						}
						onClick={toggleTheme}
						size="sm"
						variant="ghost"
					>
						{isDark ? <SunIcon /> : <MoonIcon />}
					</Button>
				</div>
			</div>
		</header>
	);
}
