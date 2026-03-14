import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl } from "../resources/extensions/search-the-web/http.ts";

// ─── Public URLs pass ────────────────────────────────────────────────────────

test("assertPublicUrl allows https://example.com", () => {
	assert.doesNotThrow(() => assertPublicUrl("https://example.com"));
});

test("assertPublicUrl allows https://8.8.8.8/path", () => {
	assert.doesNotThrow(() => assertPublicUrl("https://8.8.8.8/path"));
});

test("assertPublicUrl allows https://github.com/user/repo", () => {
	assert.doesNotThrow(() => assertPublicUrl("https://github.com/user/repo"));
});

// ─── Private/internal addresses blocked ──────────────────────────────────────

test("assertPublicUrl blocks localhost", () => {
	assert.throws(() => assertPublicUrl("http://localhost:3000"), /SSRF blocked/);
});

test("assertPublicUrl blocks 127.0.0.1", () => {
	assert.throws(() => assertPublicUrl("http://127.0.0.1"), /SSRF blocked/);
});

test("assertPublicUrl blocks 127.x.x.x range", () => {
	assert.throws(() => assertPublicUrl("http://127.255.255.255"), /SSRF blocked/);
});

test("assertPublicUrl blocks 10.x.x.x (Class A private)", () => {
	assert.throws(() => assertPublicUrl("http://10.0.0.1"), /SSRF blocked/);
});

test("assertPublicUrl blocks 172.16.x.x (Class B private)", () => {
	assert.throws(() => assertPublicUrl("http://172.16.0.1"), /SSRF blocked/);
});

test("assertPublicUrl blocks 172.31.x.x (Class B private upper)", () => {
	assert.throws(() => assertPublicUrl("http://172.31.255.255"), /SSRF blocked/);
});

test("assertPublicUrl allows 172.32.0.1 (outside private range)", () => {
	assert.doesNotThrow(() => assertPublicUrl("http://172.32.0.1"));
});

test("assertPublicUrl blocks 192.168.x.x (Class C private)", () => {
	assert.throws(() => assertPublicUrl("http://192.168.1.1"), /SSRF blocked/);
});

test("assertPublicUrl blocks 169.254.x.x (link-local)", () => {
	assert.throws(() => assertPublicUrl("http://169.254.169.254"), /SSRF blocked/);
});

test("assertPublicUrl blocks 0.x.x.x", () => {
	assert.throws(() => assertPublicUrl("http://0.0.0.0"), /SSRF blocked/);
});

test("assertPublicUrl blocks IPv6 ::1", () => {
	assert.throws(() => assertPublicUrl("http://[::1]:8080"), /SSRF blocked/);
});

test("assertPublicUrl blocks fc00:: (IPv6 ULA)", () => {
	assert.throws(() => assertPublicUrl("http://[fc00::1]"), /SSRF blocked/);
});

test("assertPublicUrl blocks fd00:: (IPv6 ULA)", () => {
	assert.throws(() => assertPublicUrl("http://[fd12::1]"), /SSRF blocked/);
});

test("assertPublicUrl blocks fe80:: (IPv6 link-local)", () => {
	assert.throws(() => assertPublicUrl("http://[fe80::1]"), /SSRF blocked/);
});

// ─── Invalid URLs ────────────────────────────────────────────────────────────

test("assertPublicUrl throws on invalid URL", () => {
	assert.throws(() => assertPublicUrl("not-a-url"), /Invalid URL/);
});

test("assertPublicUrl throws on empty string", () => {
	assert.throws(() => assertPublicUrl(""), /Invalid URL/);
});
