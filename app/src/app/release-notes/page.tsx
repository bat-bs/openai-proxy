import { getAppVersion, getReleaseNotes } from "~/lib/release-notes";

export const metadata = {
	title: "Release Notes",
};

export default async function ReleaseNotesPage() {
	const notes = await getReleaseNotes();
	const version = getAppVersion();

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
			<header className="flex flex-col gap-1">
				<p className="text-muted-foreground text-xs">Version</p>
				<h1 className="font-semibold text-2xl">v{version}</h1>
			</header>
			<pre className="whitespace-pre-wrap rounded-none border border-border bg-muted/30 p-4 text-sm leading-relaxed">
				{notes}
			</pre>
		</div>
	);
}
