import test from "node:test";
import assert from "node:assert/strict";
import {
	formatUptime,
	detectProcessType,
	generateChangeSummary,
	matchesErrorPattern,
	matchesWarningPattern,
	matchesReadinessPattern,
	extractUrls,
	extractPorts,
	formatDigestText,
} from "../resources/extensions/bg-shell/helpers.ts";

// ── formatUptime ──────────────────────────────────────────────────────────

test("formatUptime returns seconds for < 60s", () => {
	assert.equal(formatUptime(0), "0s");
	assert.equal(formatUptime(999), "0s");
	assert.equal(formatUptime(5000), "5s");
	assert.equal(formatUptime(59999), "59s");
});

test("formatUptime returns minutes and seconds for < 60m", () => {
	assert.equal(formatUptime(60000), "1m 0s");
	assert.equal(formatUptime(90000), "1m 30s");
	assert.equal(formatUptime(3599000), "59m 59s");
});

test("formatUptime returns hours and minutes for >= 60m", () => {
	assert.equal(formatUptime(3600000), "1h 0m");
	assert.equal(formatUptime(5400000), "1h 30m");
	assert.equal(formatUptime(7200000), "2h 0m");
});

// ── detectProcessType ─────────────────────────────────────────────────────

test("detectProcessType identifies server commands", () => {
	assert.equal(detectProcessType("npm run dev"), "server");
	assert.equal(detectProcessType("yarn start"), "server");
	assert.equal(detectProcessType("next dev"), "server");
	assert.equal(detectProcessType("uvicorn main:app"), "server");
	assert.equal(detectProcessType("http-server ."), "server");
	assert.equal(detectProcessType("flask run"), "server");
});

test("detectProcessType identifies build commands", () => {
	assert.equal(detectProcessType("npm run build"), "build");
	assert.equal(detectProcessType("tsc"), "build");
	assert.equal(detectProcessType("webpack"), "build");
	assert.equal(detectProcessType("esbuild src/index.ts"), "build");
});

test("detectProcessType identifies watcher commands", () => {
	assert.equal(detectProcessType("tsc --watch"), "watcher");
	assert.equal(detectProcessType("webpack --watch"), "watcher");
	assert.equal(detectProcessType("nodemon server.js"), "watcher");
	assert.equal(detectProcessType("chokidar src"), "watcher");
});

test("detectProcessType identifies test commands", () => {
	assert.equal(detectProcessType("npm test"), "test");
	assert.equal(detectProcessType("jest"), "test");
	assert.equal(detectProcessType("vitest"), "test");
	assert.equal(detectProcessType("pytest"), "test");
});

test("detectProcessType returns generic for unknown commands", () => {
	assert.equal(detectProcessType("echo hello"), "generic");
	assert.equal(detectProcessType("ls -la"), "generic");
	assert.equal(detectProcessType("cat file.txt"), "generic");
});

// ── generateChangeSummary ─────────────────────────────────────────────────

test("generateChangeSummary with no new output", () => {
	assert.equal(generateChangeSummary(0, 0, 0), "no new output");
});

test("generateChangeSummary with lines only", () => {
	assert.equal(generateChangeSummary(42, 0, 0), "42 new lines");
});

test("generateChangeSummary with lines and errors", () => {
	assert.equal(generateChangeSummary(10, 3, 0), "10 new lines, 3 new errors");
});

test("generateChangeSummary with lines, errors, and warnings", () => {
	assert.equal(
		generateChangeSummary(10, 3, 2),
		"10 new lines, 3 new errors, 2 new warnings",
	);
});

// ── matchesErrorPattern ───────────────────────────────────────────────────

test("matchesErrorPattern detects common error strings", () => {
	assert.ok(matchesErrorPattern("Error: something went wrong"));
	assert.ok(matchesErrorPattern("FATAL: out of memory"));
	assert.ok(matchesErrorPattern("TypeError: undefined is not a function"));
	assert.ok(matchesErrorPattern("Cannot find module 'foo'"));
	assert.ok(matchesErrorPattern("ENOENT: no such file"));
	assert.ok(matchesErrorPattern("TS2304: Cannot find name"));
	assert.ok(matchesErrorPattern("[ERROR] build failed"));
});

test("matchesErrorPattern rejects benign output", () => {
	assert.ok(!matchesErrorPattern("Server started successfully"));
	assert.ok(!matchesErrorPattern("All 42 tests passed"));
	assert.ok(!matchesErrorPattern("Compiled in 2.3s"));
});

// ── matchesWarningPattern ─────────────────────────────────────────────────

test("matchesWarningPattern detects warning strings", () => {
	assert.ok(matchesWarningPattern("warning: unused variable"));
	assert.ok(matchesWarningPattern("DEPRECATED: use v2 api"));
	assert.ok(matchesWarningPattern("[WARN] config missing"));
});

// ── matchesReadinessPattern ───────────────────────────────────────────────

test("matchesReadinessPattern detects server readiness", () => {
	assert.ok(matchesReadinessPattern("listening on port 3000"));
	assert.ok(matchesReadinessPattern("Server running at http://localhost:3000"));
	assert.ok(matchesReadinessPattern("Local: http://localhost:5173/"));
	assert.ok(matchesReadinessPattern("Uvicorn running on http://127.0.0.1:8000"));
	assert.ok(matchesReadinessPattern("compiled successfully"));
	assert.ok(matchesReadinessPattern("watching for file changes"));
});

// ── extractUrls ───────────────────────────────────────────────────────────

test("extractUrls finds URLs in output", () => {
	const urls = extractUrls("Server at http://localhost:3000 and https://example.com/path");
	assert.equal(urls.length, 2);
	assert.ok(urls[0].includes("localhost:3000"));
	assert.ok(urls[1].includes("example.com"));
});

test("extractUrls returns empty for no URLs", () => {
	assert.deepEqual(extractUrls("no urls here"), []);
});

// ── extractPorts ──────────────────────────────────────────────────────────

test("extractPorts finds port numbers in listening messages", () => {
	const ports = extractPorts("listening on port 3000");
	assert.ok(ports.includes(3000));
});

test("extractPorts finds colon-prefixed ports", () => {
	const ports = extractPorts("http://localhost:8080/api");
	assert.ok(ports.includes(8080));
});

test("extractPorts ignores invalid port numbers", () => {
	const ports = extractPorts("port 99999");
	assert.equal(ports.length, 0);
});

// ── formatDigestText ──────────────────────────────────────────────────────

test("formatDigestText produces structured output", () => {
	const text = formatDigestText(
		{ id: "abc123", label: "dev server", processType: "server" },
		{
			status: "ready",
			uptime: "5m 30s",
			errors: [],
			warnings: [],
			urls: ["http://localhost:3000"],
			ports: [3000],
			lastActivity: "10s ago",
			outputLines: 42,
			changeSummary: "5 new lines",
		},
	);
	assert.ok(text.includes("abc123"));
	assert.ok(text.includes("dev server"));
	assert.ok(text.includes("ready"));
	assert.ok(text.includes("server"));
	assert.ok(text.includes("3000"));
	assert.ok(text.includes("42 lines"));
	assert.ok(text.includes("5 new lines"));
});

test("formatDigestText includes errors and warnings when present", () => {
	const text = formatDigestText(
		{ id: "x", label: "build", processType: "build" },
		{
			status: "error",
			uptime: "1m 0s",
			errors: ["TS2304: Cannot find name 'foo'"],
			warnings: ["unused import"],
			urls: [],
			ports: [],
			lastActivity: "2s ago",
			outputLines: 10,
			changeSummary: "3 new lines, 1 new errors",
		},
	);
	assert.ok(text.includes("errors (1)"));
	assert.ok(text.includes("TS2304"));
	assert.ok(text.includes("warnings (1)"));
	assert.ok(text.includes("unused import"));
});
