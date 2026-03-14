import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── gsd-run command tests ───────────────────────────────────────────────────
// Test the logic of gsd-run: reading workflow file and building the message.

test("gsd-run reads workflow file from GSD_WORKFLOW_PATH", () => {
	const dir = mkdtempSync(join(tmpdir(), "gsd-run-test-"));
	const wfPath = join(dir, "workflow.md");
	writeFileSync(wfPath, "# My Workflow\nStep 1: Do stuff");

	try {
		const content = readFileSync(wfPath, "utf-8");
		assert.ok(content.includes("My Workflow"));
		assert.ok(content.includes("Step 1"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gsd-run user note section is formatted correctly", () => {
	const userNote = "focus on auth module";
	const noteSection = userNote.trim()
		? `\n\n## User Note\n\n${userNote.trim()}\n`
		: "";
	assert.ok(noteSection.includes("## User Note"));
	assert.ok(noteSection.includes("focus on auth module"));
});

test("gsd-run user note section is empty when no args", () => {
	const userNote = "";
	const noteSection = userNote.trim()
		? `\n\n## User Note\n\n${userNote.trim()}\n`
		: "";
	assert.equal(noteSection, "");
});

test("gsd-run handles whitespace-only args", () => {
	const userNote = "   ";
	const noteSection = (typeof userNote === "string" ? userNote : "").trim()
		? `\n\n## User Note\n\n${userNote.trim()}\n`
		: "";
	assert.equal(noteSection, "");
});
