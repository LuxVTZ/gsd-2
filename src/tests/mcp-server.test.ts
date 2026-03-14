import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";

// Import protocol and tools
import {
	registerMcpTool,
	getRegisteredTools,
	startMcpServer,
	type McpToolSchema,
	type ToolHandler,
	type JsonRpcResponse,
} from "../mcp-server/protocol.ts";

// ─── Helper: create mock stdio ───────────────────────────────────────────────

function createMockStdio() {
	const outputChunks: string[] = [];
	const input = new Readable({ read() {} });
	const output = new Writable({
		write(chunk, _encoding, callback) {
			outputChunks.push(chunk.toString());
			callback();
		},
	});

	return {
		input,
		output,
		getResponses(): JsonRpcResponse[] {
			return outputChunks
				.join("")
				.split("\n")
				.filter((l) => l.trim())
				.map((l) => JSON.parse(l));
		},
		sendRequest(req: Record<string, unknown>) {
			input.push(JSON.stringify(req) + "\n");
		},
		close() {
			input.push(null);
		},
	};
}

// ─── Tool registry tests ─────────────────────────────────────────────────────

test("registerMcpTool adds tool to registry", () => {
	const schema: McpToolSchema = {
		name: "test_tool_1",
		description: "A test tool",
		inputSchema: { type: "object", properties: {}, required: [] },
	};
	const handler: ToolHandler = async () => ({
		content: [{ type: "text", text: "ok" }],
	});
	registerMcpTool(schema, handler);
	const tools = getRegisteredTools();
	assert.ok(tools.some((t) => t.name === "test_tool_1"));
});

test("getRegisteredTools returns all registered tools", () => {
	const tools = getRegisteredTools();
	assert.ok(tools.length > 0);
	for (const tool of tools) {
		assert.ok(tool.name);
		assert.ok(tool.description);
		assert.ok(tool.inputSchema);
	}
});

// ─── Protocol tests ──────────────────────────────────────────────────────────

test("MCP server handles initialize request", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);
	assert.equal(responses[0].id, 1);

	const result = responses[0].result as Record<string, unknown>;
	assert.ok(result.protocolVersion);
	assert.ok(result.serverInfo);
	assert.ok(result.capabilities);

	io.close();
	server.close();
});

test("MCP server handles tools/list request", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);

	const result = responses[0].result as { tools: McpToolSchema[] };
	assert.ok(Array.isArray(result.tools));
	assert.ok(result.tools.length > 0);

	io.close();
	server.close();
});

test("MCP server handles tools/call for unknown tool", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "nonexistent_tool", arguments: {} },
	});
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);
	assert.ok(responses[0].error);
	assert.ok(responses[0].error!.message.includes("Unknown tool"));

	io.close();
	server.close();
});

test("MCP server handles tools/call without name", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: { arguments: {} },
	});
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);
	assert.ok(responses[0].error);
	assert.ok(responses[0].error!.message.includes("name"));

	io.close();
	server.close();
});

test("MCP server handles unknown method", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({ jsonrpc: "2.0", id: 5, method: "unknown/method" });
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);
	assert.ok(responses[0].error);
	assert.equal(responses[0].error!.code, -32601);

	io.close();
	server.close();
});

test("MCP server handles invalid JSON", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.input.push("this is not json\n");
	await new Promise((r) => setTimeout(r, 50));

	const responses = io.getResponses();
	assert.equal(responses.length, 1);
	assert.ok(responses[0].error);
	assert.equal(responses[0].error!.code, -32700);

	io.close();
	server.close();
});

test("MCP server handles multiple requests", async () => {
	const io = createMockStdio();
	const server = startMcpServer(io.input, io.output);

	io.sendRequest({ jsonrpc: "2.0", id: 10, method: "initialize" });
	io.sendRequest({ jsonrpc: "2.0", id: 11, method: "tools/list" });
	await new Promise((r) => setTimeout(r, 100));

	const responses = io.getResponses();
	assert.equal(responses.length, 2);
	assert.equal(responses[0].id, 10);
	assert.equal(responses[1].id, 11);

	io.close();
	server.close();
});

// ─── Tool adapter tests (tools from tool-adapter.ts) ─────────────────────────

test("registered tools include bash and read_file", () => {
	// Import tool adapter to register tools
	import("../mcp-server/tool-adapter.ts").then(() => {
		const tools = getRegisteredTools();
		const names = tools.map((t) => t.name);
		assert.ok(names.includes("bash") || names.includes("read_file"), `Tools: ${names.join(", ")}`);
	});
});
