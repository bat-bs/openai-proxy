export const DEFAULT_BACKEND_NAME = "openai";

/**
 * @param {string | null | undefined} backendName
 */
export function normalizeBackendName(backendName) {
	const normalized = backendName?.trim() ?? "";
	return normalized.length > 0 ? normalized : DEFAULT_BACKEND_NAME;
}
