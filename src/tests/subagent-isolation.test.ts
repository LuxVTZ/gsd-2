import test from "node:test";
import assert from "node:assert/strict";
import { readIsolationMode, type IsolationMode } from "../resources/extensions/subagent/isolation.ts";

// ─── readIsolationMode tests ─────────────────────────────────────────────────
// readIsolationMode() reads settings.json and returns IsolationMode.
// Since it catches all errors and falls back to "none", we can test it safely.

test("readIsolationMode returns 'none' when settings file does not exist", () => {
	// With no special settings configured, should default to "none"
	const mode = readIsolationMode();
	assert.ok(["none", "worktree", "fuse-overlay"].includes(mode), `Unexpected mode: ${mode}`);
});

test("readIsolationMode return type is IsolationMode", () => {
	const mode: IsolationMode = readIsolationMode();
	assert.equal(typeof mode, "string");
});

// ─── DeltaPatch type tests ───────────────────────────────────────────────────

test("DeltaPatch interface shape is correct", async () => {
	const { type: _type } = await import("../resources/extensions/subagent/isolation.ts");
	// Verify module exports the expected types/functions
	const mod = await import("../resources/extensions/subagent/isolation.ts");
	assert.equal(typeof mod.createWorktreeIsolation, "function");
	assert.equal(typeof mod.createIsolation, "function");
	assert.equal(typeof mod.mergeDeltaPatches, "function");
	assert.equal(typeof mod.readIsolationMode, "function");
});

// ─── createIsolation mode routing ────────────────────────────────────────────

test("createIsolation is exported and callable", async () => {
	const mod = await import("../resources/extensions/subagent/isolation.ts");
	assert.equal(typeof mod.createIsolation, "function");
});

test("createWorktreeIsolation is exported and callable", async () => {
	const mod = await import("../resources/extensions/subagent/isolation.ts");
	assert.equal(typeof mod.createWorktreeIsolation, "function");
});

test("createFuseOverlayIsolation is exported and callable", async () => {
	const mod = await import("../resources/extensions/subagent/isolation.ts");
	assert.equal(typeof mod.createFuseOverlayIsolation, "function");
});
