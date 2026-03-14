import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, createDebouncer, shouldIgnore } from "../resources/extensions/file-watcher/index.ts";

// ─── parseConfig ─────────────────────────────────────────────────────────────

test("parseConfig returns defaults when no prefs", () => {
	const config = parseConfig(undefined);
	assert.equal(config.enabled, false);
	assert.deepEqual(config.patterns, ["src", ".gsd"]);
	assert.ok(config.ignore.includes("node_modules"));
	assert.equal(config.debounceMs, 300);
});

test("parseConfig reads file-watcher preferences", () => {
	const config = parseConfig({
		"file-watcher": {
			enabled: true,
			patterns: ["lib", "test"],
			ignore: ["build"],
			debounce: 500,
		},
	});
	assert.equal(config.enabled, true);
	assert.deepEqual(config.patterns, ["lib", "test"]);
	assert.deepEqual(config.ignore, ["build"]);
	assert.equal(config.debounceMs, 500);
});

test("parseConfig handles partial preferences", () => {
	const config = parseConfig({
		"file-watcher": { enabled: true },
	});
	assert.equal(config.enabled, true);
	assert.deepEqual(config.patterns, ["src", ".gsd"]); // defaults
});

test("parseConfig handles camelCase key", () => {
	const config = parseConfig({
		fileWatcher: { enabled: true },
	});
	assert.equal(config.enabled, true);
});

// ─── shouldIgnore ────────────────────────────────────────────────────────────

test("shouldIgnore returns true for node_modules path", () => {
	assert.equal(shouldIgnore("node_modules/foo/bar.js", ["node_modules"]), true);
});

test("shouldIgnore returns true for dist path", () => {
	assert.equal(shouldIgnore("dist/cli.js", ["dist"]), true);
});

test("shouldIgnore returns false for src path", () => {
	assert.equal(shouldIgnore("src/index.ts", ["node_modules", "dist"]), false);
});

test("shouldIgnore handles nested ignored directories", () => {
	assert.equal(shouldIgnore("src/node_modules/pkg/index.js", ["node_modules"]), true);
});

test("shouldIgnore returns false for empty ignore list", () => {
	assert.equal(shouldIgnore("anything/goes.ts", []), false);
});

test("shouldIgnore handles .git", () => {
	assert.equal(shouldIgnore(".git/objects/abc123", [".git"]), true);
});

// ─── createDebouncer ─────────────────────────────────────────────────────────

test("createDebouncer calls function after delay", async () => {
	const debouncer = createDebouncer(50);
	let called = false;
	debouncer.debounce("test", () => { called = true; });
	assert.equal(called, false);
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(called, true);
	debouncer.clear();
});

test("createDebouncer deduplicates rapid calls", async () => {
	const debouncer = createDebouncer(50);
	let callCount = 0;
	debouncer.debounce("key", () => { callCount++; });
	debouncer.debounce("key", () => { callCount++; });
	debouncer.debounce("key", () => { callCount++; });
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(callCount, 1);
	debouncer.clear();
});

test("createDebouncer handles different keys independently", async () => {
	const debouncer = createDebouncer(50);
	let a = 0, b = 0;
	debouncer.debounce("a", () => { a++; });
	debouncer.debounce("b", () => { b++; });
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(a, 1);
	assert.equal(b, 1);
	debouncer.clear();
});

test("createDebouncer clear cancels pending calls", async () => {
	const debouncer = createDebouncer(50);
	let called = false;
	debouncer.debounce("test", () => { called = true; });
	debouncer.clear();
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(called, false);
});
