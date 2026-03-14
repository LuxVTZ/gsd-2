import test from "node:test";
import assert from "node:assert/strict";

// We import the factory and capture stderr output for verification
import { createLogger } from "../resources/extensions/shared/logger.ts";

// ─── Helper to capture stderr ────────────────────────────────────────────────

function captureStderr(fn: () => void): string {
	const chunks: Buffer[] = [];
	const origWrite = process.stderr.write;
	process.stderr.write = (chunk: string | Uint8Array) => {
		chunks.push(Buffer.from(chunk));
		return true;
	};
	try {
		fn();
	} finally {
		process.stderr.write = origWrite;
	}
	return Buffer.concat(chunks).toString("utf-8");
}

// ─── Level filtering ─────────────────────────────────────────────────────────

test("logger respects GSD_LOG_LEVEL=error (suppresses info/warn)", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	process.env.GSD_LOG_LEVEL = "error";
	try {
		const log = createLogger("test");
		const output = captureStderr(() => {
			log.debug("d");
			log.info("i");
			log.warn("w");
		});
		assert.equal(output, "");
	} finally {
		if (orig === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = orig;
	}
});

test("logger outputs error when level=error", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	process.env.GSD_LOG_LEVEL = "error";
	try {
		const log = createLogger("test");
		const output = captureStderr(() => log.error("boom"));
		assert.ok(output.includes("[ERROR]"));
		assert.ok(output.includes("boom"));
	} finally {
		if (orig === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = orig;
	}
});

test("logger outputs debug when level=debug", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	process.env.GSD_LOG_LEVEL = "debug";
	try {
		const log = createLogger("mycomp");
		const output = captureStderr(() => log.debug("trace"));
		assert.ok(output.includes("[DEBUG]"));
		assert.ok(output.includes("[mycomp]"));
		assert.ok(output.includes("trace"));
	} finally {
		if (orig === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = orig;
	}
});

test("logger defaults to info level", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	delete process.env.GSD_LOG_LEVEL;
	try {
		const log = createLogger("test");
		const debugOut = captureStderr(() => log.debug("hidden"));
		assert.equal(debugOut, "");
		const infoOut = captureStderr(() => log.info("visible"));
		assert.ok(infoOut.includes("visible"));
	} finally {
		if (orig !== undefined) process.env.GSD_LOG_LEVEL = orig;
	}
});

// ─── JSON mode ───────────────────────────────────────────────────────────────

test("logger outputs valid JSON in GSD_LOG_JSON=1 mode", () => {
	const origLevel = process.env.GSD_LOG_LEVEL;
	const origJson = process.env.GSD_LOG_JSON;
	process.env.GSD_LOG_LEVEL = "info";
	process.env.GSD_LOG_JSON = "1";
	try {
		const log = createLogger("api");
		const output = captureStderr(() => log.info("request", { url: "https://example.com" }));
		const parsed = JSON.parse(output.trim());
		assert.equal(parsed.level, "info");
		assert.equal(parsed.component, "api");
		assert.equal(parsed.msg, "request");
		assert.equal(parsed.url, "https://example.com");
		assert.ok(parsed.ts); // timestamp exists
	} finally {
		if (origLevel === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = origLevel;
		if (origJson === undefined) delete process.env.GSD_LOG_JSON;
		else process.env.GSD_LOG_JSON = origJson;
	}
});

test("logger JSON mode does not include data when not provided", () => {
	const origLevel = process.env.GSD_LOG_LEVEL;
	const origJson = process.env.GSD_LOG_JSON;
	process.env.GSD_LOG_LEVEL = "info";
	process.env.GSD_LOG_JSON = "1";
	try {
		const log = createLogger("test");
		const output = captureStderr(() => log.info("simple"));
		const parsed = JSON.parse(output.trim());
		assert.equal(parsed.msg, "simple");
		assert.equal(Object.keys(parsed).length, 4); // ts, level, component, msg
	} finally {
		if (origLevel === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_JSON = origJson;
		if (origJson === undefined) delete process.env.GSD_LOG_JSON;
		else process.env.GSD_LOG_JSON = origJson;
	}
});

// ─── Component prefix ────────────────────────────────────────────────────────

test("logger includes component name in text mode", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	const origJson = process.env.GSD_LOG_JSON;
	process.env.GSD_LOG_LEVEL = "info";
	delete process.env.GSD_LOG_JSON;
	try {
		const log = createLogger("gh-api");
		const output = captureStderr(() => log.warn("rate limited", { remaining: 0 }));
		assert.ok(output.includes("[WARN]"));
		assert.ok(output.includes("[gh-api]"));
		assert.ok(output.includes("rate limited"));
		assert.ok(output.includes('"remaining":0'));
	} finally {
		if (orig === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = orig;
		if (origJson !== undefined) process.env.GSD_LOG_JSON = origJson;
	}
});

test("logger omits data object when empty in text mode", () => {
	const orig = process.env.GSD_LOG_LEVEL;
	const origJson = process.env.GSD_LOG_JSON;
	process.env.GSD_LOG_LEVEL = "info";
	delete process.env.GSD_LOG_JSON;
	try {
		const log = createLogger("test");
		const output = captureStderr(() => log.info("clean message"));
		assert.ok(!output.includes("{}"));
		assert.ok(output.endsWith("clean message\n"));
	} finally {
		if (orig === undefined) delete process.env.GSD_LOG_LEVEL;
		else process.env.GSD_LOG_LEVEL = orig;
		if (origJson !== undefined) process.env.GSD_LOG_JSON = origJson;
	}
});
