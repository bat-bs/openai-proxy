"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "~/components/ui/button"
import { Separator } from "~/components/ui/separator"
import { SidebarTrigger } from "~/components/ui/sidebar"
export function SiteHeader() {
    const [isDark, setIsDark] = useState(false)

    useEffect(() => {
        const stored = localStorage.getItem("theme")
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
        const initial = stored ? stored === "dark" : prefersDark
        setIsDark(initial)
        document.documentElement.classList.toggle("dark", initial)
    }, [])

    const toggleTheme = () => {
        const next = !isDark
        setIsDark(next)
        document.documentElement.classList.toggle("dark", next)
        localStorage.setItem("theme", next ? "dark" : "light")
    }

    return (
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
            <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator
                    orientation="vertical"
                    className="mx-2 data-[orientation=vertical]:h-8"
                />
                <h1 className="text-base font-medium">Documents</h1>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="hidden sm:flex">
                        <a
                            href="https://api.chat.redoak.blue-atlas.cloud"
                            rel="noopener noreferrer"
                            target="_blank"
                            className="dark:text-foreground"
                        >
                            API-Keys verwalten
                        </a>
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleTheme}
                        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                    >
                        {isDark ? <SunIcon /> : <MoonIcon />}
                    </Button>
                </div>
            </div>
        </header>
    )
}
