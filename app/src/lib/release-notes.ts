import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import pkg from "../../package.json";

const releaseNotesPath = path.join(process.cwd(), "RELEASE_NOTES.md");

export async function getReleaseNotes(): Promise<string> {
	return fs.readFile(releaseNotesPath, "utf8");
}

export function getAppVersion(): string {
	return pkg.version ?? "0.0.0";
}
