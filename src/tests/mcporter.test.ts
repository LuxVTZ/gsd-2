import test from "node:test";
import assert from "node:assert/strict";
import {
	escapeShellArg,
	formatServerList,
	formatServerDetail,
} from "../resources/extensions/mcporter/index.ts";
import type {
	McpServer,
	McpServerDetail,
} from "../resources/extensions/mcporter/index.ts";

// ── escapeShellArg ────────────────────────────────────────────────────────

test("escapeShellArg wraps in single quotes on non-Windows", () => {
	// Test runs on Linux, so this tests the Unix path
	const result = escapeShellArg("hello world");
	assert.equal(result, "'hello world'");
});

test("escapeShellArg escapes embedded single quotes", () => {
	const result = escapeShellArg("it's a test");
	assert.equal(result, "'it'\\''s a test'");
});

test("escapeShellArg handles empty string", () => {
	const result = escapeShellArg("");
	assert.equal(result, "''");
});

// ── formatServerList ──────────────────────────────────────────────────────

test("formatServerList returns message for empty list", () => {
	assert.equal(formatServerList([]), "No MCP servers found.");
});

test("formatServerList formats servers with status icons", () => {
	const servers: McpServer[] = [
		{ name: "railway", status: "ok", tools: [{ name: "list_projects", description: "List all projects" }] },
		{ name: "twitter", status: "auth", tools: [] },
		{ name: "broken", status: "error", tools: [] },
	];
	const result = formatServerList(servers);
	assert.ok(result.includes("3 MCP servers available:"));
	assert.ok(result.includes("✓ railway"));
	assert.ok(result.includes("🔑 twitter"));
	assert.ok(result.includes("✗ broken"));
	assert.ok(result.includes("1 tools (ok)"));
	assert.ok(result.includes("list_projects: List all projects"));
});

test("formatServerList includes footer with usage instructions", () => {
	const servers: McpServer[] = [
		{ name: "test-server", status: "ok", tools: [] },
	];
	const result = formatServerList(servers);
	assert.ok(result.includes("Use mcp_discover"));
	assert.ok(result.includes("Use mcp_call"));
});

test("formatServerList truncates long tool descriptions", () => {
	const longDesc = "A".repeat(200);
	const servers: McpServer[] = [
		{ name: "srv", status: "ok", tools: [{ name: "tool1", description: longDesc }] },
	];
	const result = formatServerList(servers);
	// Description should be sliced to 100 chars
	assert.ok(!result.includes(longDesc));
	assert.ok(result.includes("A".repeat(100)));
});

test("formatServerList handles servers with missing tools array", () => {
	const servers: McpServer[] = [
		{ name: "no-tools", status: "ok" } as McpServer,
	];
	const result = formatServerList(servers);
	assert.ok(result.includes("✓ no-tools"));
	assert.ok(result.includes("0 tools"));
});

// ── formatServerDetail ────────────────────────────────────────────────────

test("formatServerDetail formats tools with descriptions", () => {
	const detail: McpServerDetail = {
		name: "railway",
		status: "ok",
		tools: [
			{ name: "list_projects", description: "List all Railway projects" },
			{ name: "deploy", description: "Deploy a service" },
		],
	};
	const result = formatServerDetail(detail);
	assert.ok(result.includes("railway — 2 tools:"));
	assert.ok(result.includes("## list_projects"));
	assert.ok(result.includes("List all Railway projects"));
	assert.ok(result.includes("## deploy"));
	assert.ok(result.includes("Deploy a service"));
	assert.ok(result.includes('mcp_call(server="railway"'));
});

test("formatServerDetail renders JSON schemas in code blocks", () => {
	const detail: McpServerDetail = {
		name: "test-srv",
		status: "ok",
		tools: [
			{
				name: "create_item",
				description: "Create an item",
				inputSchema: {
					type: "object",
					properties: { title: { type: "string" } },
					required: ["title"],
				},
			},
		],
	};
	const result = formatServerDetail(detail);
	assert.ok(result.includes("```json"));
	assert.ok(result.includes('"title"'));
	assert.ok(result.includes('"type": "string"'));
	assert.ok(result.includes("```"));
});

test("formatServerDetail handles tools without schemas", () => {
	const detail: McpServerDetail = {
		name: "simple",
		status: "ok",
		tools: [{ name: "ping", description: "Ping the server" }],
	};
	const result = formatServerDetail(detail);
	assert.ok(result.includes("## ping"));
	assert.ok(result.includes("Ping the server"));
	assert.ok(!result.includes("```json"));
});

test("formatServerDetail handles tools without descriptions", () => {
	const detail: McpServerDetail = {
		name: "nodesc",
		status: "ok",
		tools: [{ name: "mystery_tool", description: "" }],
	};
	const result = formatServerDetail(detail);
	assert.ok(result.includes("## mystery_tool"));
});

test("formatServerDetail handles empty tools list", () => {
	const detail: McpServerDetail = {
		name: "empty",
		status: "ok",
		tools: [],
	};
	const result = formatServerDetail(detail);
	assert.ok(result.includes("empty — 0 tools:"));
	assert.ok(result.includes('mcp_call(server="empty"'));
});
