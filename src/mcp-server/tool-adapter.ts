/**
 * MCP Tool Adapter — registers core GSD tools with the MCP server.
 *
 * Adapts GSD's internal tools to MCP tool format:
 * - bash: execute shell commands
 * - read_file: read file contents
 * - write_file: write file contents
 * - list_files: list directory contents
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { registerMcpTool, type ToolHandler } from "./protocol.js";

function textResult(text: string, isError = false) {
	return { content: [{ type: "text" as const, text }], isError };
}

// ─── bash tool ────────────────────────────────────────────────────────────────

const bashHandler: ToolHandler = async (params) => {
	const command = params.command as string;
	if (!command) return textResult("Missing required parameter: command", true);

	try {
		const result = execFileSync("/bin/sh", ["-c", command], {
			encoding: "utf-8",
			timeout: 30_000,
			cwd: params.cwd as string | undefined ?? process.cwd(),
			stdio: ["pipe", "pipe", "pipe"],
		});
		return textResult(result);
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; message?: string };
		return textResult(`${e.stderr || e.stdout || e.message || String(err)}`, true);
	}
};

registerMcpTool(
	{
		name: "bash",
		description: "Execute a shell command and return the output",
		inputSchema: {
			type: "object",
			properties: {
				command: { type: "string", description: "The shell command to execute" },
				cwd: { type: "string", description: "Working directory (optional)" },
			},
			required: ["command"],
		},
	},
	bashHandler,
);

// ─── read_file tool ───────────────────────────────────────────────────────────

const readFileHandler: ToolHandler = async (params) => {
	const path = params.path as string;
	if (!path) return textResult("Missing required parameter: path", true);

	try {
		const absPath = resolve(process.cwd(), path);
		const content = readFileSync(absPath, "utf-8");
		return textResult(content);
	} catch (err) {
		return textResult(`Error reading file: ${err instanceof Error ? err.message : String(err)}`, true);
	}
};

registerMcpTool(
	{
		name: "read_file",
		description: "Read the contents of a file",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file (relative or absolute)" },
			},
			required: ["path"],
		},
	},
	readFileHandler,
);

// ─── write_file tool ──────────────────────────────────────────────────────────

const writeFileHandler: ToolHandler = async (params) => {
	const path = params.path as string;
	const content = params.content as string;
	if (!path) return textResult("Missing required parameter: path", true);
	if (content === undefined) return textResult("Missing required parameter: content", true);

	try {
		const absPath = resolve(process.cwd(), path);
		writeFileSync(absPath, content, "utf-8");
		return textResult(`Written ${content.length} bytes to ${path}`);
	} catch (err) {
		return textResult(`Error writing file: ${err instanceof Error ? err.message : String(err)}`, true);
	}
};

registerMcpTool(
	{
		name: "write_file",
		description: "Write content to a file (creates or overwrites)",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file" },
				content: { type: "string", description: "Content to write" },
			},
			required: ["path", "content"],
		},
	},
	writeFileHandler,
);

// ─── list_files tool ──────────────────────────────────────────────────────────

const listFilesHandler: ToolHandler = async (params) => {
	const dir = (params.path as string) ?? ".";
	try {
		const absDir = resolve(process.cwd(), dir);
		const entries = readdirSync(absDir);
		const lines = entries.map((e) => {
			try {
				const stat = statSync(resolve(absDir, e));
				return `${stat.isDirectory() ? "d" : "-"} ${e}`;
			} catch {
				return `? ${e}`;
			}
		});
		return textResult(lines.join("\n") || "(empty directory)");
	} catch (err) {
		return textResult(`Error listing directory: ${err instanceof Error ? err.message : String(err)}`, true);
	}
};

registerMcpTool(
	{
		name: "list_files",
		description: "List files and directories in a path",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Directory path (default: current directory)" },
			},
		},
	},
	listFilesHandler,
);
