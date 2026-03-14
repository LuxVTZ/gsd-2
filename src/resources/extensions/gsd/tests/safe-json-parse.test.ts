import test from "node:test";
import assert from "node:assert/strict";
import { safeJsonParse } from "./safe-json-parse-helper.ts";

// ─── Valid JSON ──────────────────────────────────────────────────────────────

test("safeJsonParse parses valid JSON object", () => {
	assert.deepEqual(safeJsonParse('{"a":1}', {}), { a: 1 });
});

test("safeJsonParse parses valid JSON array", () => {
	assert.deepEqual(safeJsonParse("[1,2,3]", []), [1, 2, 3]);
});

test("safeJsonParse parses valid JSON string", () => {
	assert.equal(safeJsonParse('"hello"', ""), "hello");
});

test("safeJsonParse parses valid JSON number", () => {
	assert.equal(safeJsonParse("42", 0), 42);
});

test("safeJsonParse parses valid JSON boolean", () => {
	assert.equal(safeJsonParse("true", false), true);
});

test("safeJsonParse parses null", () => {
	assert.equal(safeJsonParse("null", "default"), null);
});

// ─── Malformed JSON returns fallback ─────────────────────────────────────────

test("safeJsonParse returns fallback for malformed JSON", () => {
	assert.equal(safeJsonParse("{bad json}", "fallback"), "fallback");
});

test("safeJsonParse returns fallback for empty string", () => {
	assert.deepEqual(safeJsonParse("", []), []);
});

test("safeJsonParse returns fallback for truncated JSON", () => {
	assert.deepEqual(safeJsonParse('{"key": "val', {}), {});
});

test("safeJsonParse returns fallback for undefined-like input", () => {
	assert.equal(safeJsonParse("undefined", null), null);
});

test("safeJsonParse returns object fallback for garbage", () => {
	const fallback = { default: true };
	assert.deepEqual(safeJsonParse("~~~", fallback), fallback);
});
