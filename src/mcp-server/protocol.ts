/**
 * MCP (Model Context Protocol) Server — JSON-RPC over stdio.
 *
 * Implements the stable subset of MCP:
 * - initialize → capabilities
 * - tools/list → available tool schemas
 * - tools/call → execute a tool
 *
 * Protocol: line-delimited JSON-RPC 2.0 on stdin/stdout.
 */

import { createInterface } from "node:readline";
import { createLogger } from "../resources/extensions/shared/logger.js";

const log = createLogger("mcp-server");

// ─── JSON-RPC types ───────────────────────────────────────────────────────────

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

// ─── MCP tool schema ──────────────────────────────────────────────────────────

export interface McpToolSchema {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export interface McpServerCapabilities {
	tools?: { listChanged?: boolean };
}

// ─── Tool registry ────────────────────────────────────────────────────────────

export type ToolHandler = (params: Record<string, unknown>) => Promise<{
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}>;

const toolRegistry = new Map<string, { schema: McpToolSchema; handler: ToolHandler }>();

export function registerMcpTool(schema: McpToolSchema, handler: ToolHandler): void {
	toolRegistry.set(schema.name, { schema, handler });
}

export function getRegisteredTools(): McpToolSchema[] {
	return Array.from(toolRegistry.values()).map((t) => t.schema);
}

// ─── Request handlers ─────────────────────────────────────────────────────────

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
	const id = req.id ?? null;

	switch (req.method) {
		case "initialize":
			return {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					serverInfo: { name: "gsd", version: "2.10.12" },
					capabilities: {
						tools: { listChanged: false },
					} satisfies McpServerCapabilities,
				},
			};

		case "notifications/initialized":
			// Client acknowledges — no response needed for notifications
			return { jsonrpc: "2.0", id, result: {} };

		case "tools/list":
			return {
				jsonrpc: "2.0",
				id,
				result: {
					tools: getRegisteredTools(),
				},
			};

		case "tools/call": {
			const toolName = req.params?.name as string | undefined;
			const toolArgs = (req.params?.arguments ?? {}) as Record<string, unknown>;

			if (!toolName) {
				return {
					jsonrpc: "2.0",
					id,
					error: { code: -32602, message: "Missing required parameter: name" },
				};
			}

			const tool = toolRegistry.get(toolName);
			if (!tool) {
				return {
					jsonrpc: "2.0",
					id,
					error: { code: -32602, message: `Unknown tool: ${toolName}` },
				};
			}

			try {
				const result = await tool.handler(toolArgs);
				return { jsonrpc: "2.0", id, result };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text: `Error: ${message}` }],
						isError: true,
					},
				};
			}
		}

		default:
			return {
				jsonrpc: "2.0",
				id,
				error: { code: -32601, message: `Method not found: ${req.method}` },
			};
	}
}

// ─── stdio server loop ────────────────────────────────────────────────────────

export function startMcpServer(
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
): { close: () => void } {
	const rl = createInterface({ input, terminal: false });

	rl.on("line", async (line) => {
		if (!line.trim()) return;

		let req: JsonRpcRequest;
		try {
			req = JSON.parse(line);
		} catch {
			const errResponse: JsonRpcResponse = {
				jsonrpc: "2.0",
				id: null,
				error: { code: -32700, message: "Parse error" },
			};
			output.write(JSON.stringify(errResponse) + "\n");
			return;
		}

		const response = await handleRequest(req);

		// Don't send response for notifications (no id)
		if (req.id !== undefined) {
			output.write(JSON.stringify(response) + "\n");
		}
	});

	rl.on("close", () => {
		log.info("client disconnected");
		process.exit(0);
	});

	log.info("MCP server started on stdio");
	return { close: () => rl.close() };
}
