import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_BACKEND_NAME, normalizeBackendName } from "./backendName.js";

test("empty backend name normalizes the same as openai", () => {
	assert.equal(normalizeBackendName(null), DEFAULT_BACKEND_NAME);
	assert.equal(normalizeBackendName(undefined), DEFAULT_BACKEND_NAME);
	assert.equal(normalizeBackendName(""), DEFAULT_BACKEND_NAME);
	assert.equal(normalizeBackendName("   "), DEFAULT_BACKEND_NAME);
	assert.equal(
		normalizeBackendName("   openai   "),
		normalizeBackendName(DEFAULT_BACKEND_NAME),
	);
});
