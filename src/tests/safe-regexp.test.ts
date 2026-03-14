import test from "node:test";
import assert from "node:assert/strict";
import { safeRegExp } from "../resources/extensions/bg-shell/safe-regexp.ts";

// ─── Valid patterns compile successfully ─────────────────────────────────────

test("safeRegExp compiles a simple literal pattern", () => {
	const re = safeRegExp("hello");
	assert.ok(re instanceof RegExp);
	assert.ok(re.test("hello world"));
});

test("safeRegExp compiles a pattern with single quantifier", () => {
	const re = safeRegExp("a+b");
	assert.ok(re.test("aaab"));
	assert.ok(!re.test("b"));
});

test("safeRegExp compiles a character class pattern", () => {
	const re = safeRegExp("[a-z]+");
	assert.ok(re.test("abc"));
});

test("safeRegExp passes through flags", () => {
	const re = safeRegExp("hello", "gi");
	assert.equal(re.flags.includes("g"), true);
	assert.equal(re.flags.includes("i"), true);
	assert.ok(re.test("HELLO"));
});

// ─── Nested quantifiers rejected (ReDoS guard) ──────────────────────────────

test("safeRegExp rejects a++ adjacent quantifiers", () => {
	assert.throws(() => safeRegExp("a++"), /ReDoS/);
});

test("safeRegExp rejects a** adjacent quantifiers", () => {
	assert.throws(() => safeRegExp("a**"), /ReDoS/);
});

test("safeRegExp rejects a*+ mixed adjacent quantifiers", () => {
	assert.throws(() => safeRegExp("a*+"), /ReDoS/);
});

test("safeRegExp rejects a+{2} quantifier after quantifier", () => {
	assert.throws(() => safeRegExp("a+{2}"), /ReDoS/);
});

test("safeRegExp rejects nested lookahead with group", () => {
	assert.throws(() => safeRegExp("(?=a(b))"), /ReDoS/);
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

test("safeRegExp compiles empty pattern", () => {
	const re = safeRegExp("");
	assert.ok(re instanceof RegExp);
});

test("safeRegExp throws on invalid regex syntax", () => {
	assert.throws(() => safeRegExp("[invalid"));
});
