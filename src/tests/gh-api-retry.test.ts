import test from "node:test";
import assert from "node:assert/strict";
import { ghFetchWithRetry } from "../resources/extensions/github/gh-api.ts";

// ─── Mock fetch helper ───────────────────────────────────────────────────────

function mockFetch(responses: Array<{ status: number; body?: string; headers?: Record<string, string> } | "network-error">) {
	const originalFetch = globalThis.fetch;
	let callCount = 0;
	const calls: Array<{ url: string; init?: RequestInit }> = [];

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		calls.push({ url, init });
		const entry = responses[callCount++];
		if (!entry || entry === "network-error") {
			throw new TypeError("fetch failed");
		}
		const headers = new Headers(entry.headers ?? {});
		return new Response(entry.body ?? "", { status: entry.status, headers });
	};

	return {
		calls,
		getCallCount: () => callCount,
		restore: () => { globalThis.fetch = originalFetch; },
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("ghFetchWithRetry returns response on success (no retry)", async () => {
	const mock = mockFetch([{ status: 200, body: '{"ok":true}' }]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test");
		assert.equal(res.status, 200);
		assert.equal(mock.getCallCount(), 1);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry retries on 429 and succeeds", async () => {
	const mock = mockFetch([
		{ status: 429, headers: { "retry-after": "0" } },
		{ status: 200, body: '{"ok":true}' },
	]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		assert.equal(res.status, 200);
		assert.equal(mock.getCallCount(), 2);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry retries on 500 and succeeds", async () => {
	const mock = mockFetch([
		{ status: 500, body: "Internal Server Error" },
		{ status: 200, body: '{"ok":true}' },
	]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		assert.equal(res.status, 200);
		assert.equal(mock.getCallCount(), 2);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry returns error response after max retries", async () => {
	const mock = mockFetch([
		{ status: 503, body: "Unavailable" },
		{ status: 503, body: "Unavailable" },
		{ status: 503, body: "Unavailable" },
	]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		assert.equal(res.status, 503);
		assert.equal(mock.getCallCount(), 3);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry retries on network error and succeeds", async () => {
	const mock = mockFetch([
		"network-error",
		{ status: 200, body: '{"ok":true}' },
	]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		assert.equal(res.status, 200);
		assert.equal(mock.getCallCount(), 2);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry throws after all network errors", async () => {
	const mock = mockFetch([
		"network-error",
		"network-error",
		"network-error",
	]);
	try {
		await assert.rejects(
			() => ghFetchWithRetry("https://api.github.com/test", {}, 2),
			/fetch failed/,
		);
		assert.equal(mock.getCallCount(), 3);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry does not retry on 4xx (non-429)", async () => {
	const mock = mockFetch([
		{ status: 404, body: "Not Found" },
	]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		assert.equal(res.status, 404);
		assert.equal(mock.getCallCount(), 1);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry respects Retry-After header", async () => {
	const start = Date.now();
	const mock = mockFetch([
		{ status: 429, headers: { "retry-after": "0" } },
		{ status: 200, body: "ok" },
	]);
	try {
		await ghFetchWithRetry("https://api.github.com/test", {}, 2);
		const elapsed = Date.now() - start;
		// With retry-after: 0, delay should be ~0ms (not exponential backoff)
		assert.ok(elapsed < 2000, `Expected fast retry, took ${elapsed}ms`);
	} finally {
		mock.restore();
	}
});

test("ghFetchWithRetry extracts rate-limit headers", async () => {
	const mock = mockFetch([{
		status: 200,
		body: "ok",
		headers: {
			"x-ratelimit-remaining": "42",
			"x-ratelimit-limit": "5000",
			"x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
		},
	}]);
	try {
		const res = await ghFetchWithRetry("https://api.github.com/test");
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("x-ratelimit-remaining"), "42");
	} finally {
		mock.restore();
	}
});
