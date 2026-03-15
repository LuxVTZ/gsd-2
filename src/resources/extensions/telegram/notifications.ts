/**
 * Telegram Notification Formatting — pure functions for message construction.
 *
 * All functions return plain strings (HTML parse mode for Telegram).
 * Exported for testing.
 */

const TG_MAX_MESSAGE_LENGTH = 4096;

/** Escape text for Telegram HTML parse mode. */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a session start notification. */
export function formatSessionStart(workdir: string, model?: string): string {
	const lines = ["🟢 <b>GSD session started</b>"];
	lines.push(`📂 <code>${escapeHtml(workdir)}</code>`);
	if (model) lines.push(`🤖 ${escapeHtml(model)}`);
	return lines.join("\n");
}

/** Format a session end notification. */
export function formatSessionEnd(): string {
	return "🔴 <b>GSD session ended</b>";
}

/** Format context compaction notification. */
export function formatCompaction(percent?: number): string {
	const pct = percent != null ? ` (${percent}% used)` : "";
	return `📦 Context compacted${pct}`;
}

/** Format agent lifecycle events. */
export function formatAgentStart(): string {
	return "🧠 Agent thinking...";
}

export function formatAgentEnd(success: boolean, error?: string): string {
	if (success) return "✅ Agent finished";
	return `❌ Agent error: ${escapeHtml(error ?? "unknown")}`;
}

/** Format a tool execution start notification. */
export function formatToolStart(toolName: string, params?: Record<string, unknown>): string {
	let brief = "";
	if (params) {
		if (typeof params.command === "string") {
			brief = truncate(params.command, 200);
		} else if (typeof params.path === "string") {
			brief = truncate(params.path, 200);
		} else {
			const keys = Object.keys(params).slice(0, 3);
			brief = keys.join(", ");
		}
	}
	const detail = brief ? `: <code>${escapeHtml(brief)}</code>` : "";
	return `🔧 <b>${escapeHtml(toolName)}</b>${detail}`;
}

/** Format a tool execution end notification. */
export function formatToolEnd(toolName: string, success: boolean): string {
	return success ? `✓ ${escapeHtml(toolName)} done` : `✗ ${escapeHtml(toolName)} failed`;
}

/** Format agent message summary. */
export function formatMessageSummary(text: string, tokenUsage?: { input?: number; output?: number }): string {
	const lines: string[] = [];

	const truncated = truncate(text, TG_MAX_MESSAGE_LENGTH - 200);
	if (truncated.includes("```")) {
		lines.push(escapeHtml(truncated));
	} else {
		lines.push(`<pre>${escapeHtml(truncated)}</pre>`);
	}

	if (tokenUsage) {
		const parts: string[] = [];
		if (tokenUsage.input) parts.push(`in: ${tokenUsage.input}`);
		if (tokenUsage.output) parts.push(`out: ${tokenUsage.output}`);
		if (parts.length) lines.push(`📊 Tokens: ${parts.join(", ")}`);
	}

	return lines.join("\n");
}

/** Split a long message into Telegram-safe chunks. */
export function splitMessage(text: string, maxLength = TG_MAX_MESSAGE_LENGTH): string[] {
	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}
		// Try to split at newline
		let splitAt = remaining.lastIndexOf("\n", maxLength);
		if (splitAt <= 0) splitAt = maxLength;
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}
	return chunks;
}

/** Truncate text to maxLen, appending "…" if truncated. */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1) + "…";
}

/**
 * Simple debouncer for batching rapid notifications.
 * Collects items during a window, then flushes them as a single batch.
 */
export function createNotificationDebouncer(
	flushFn: (items: string[]) => void | Promise<void>,
	windowMs = 500,
): { add(item: string): void; flush(): void } {
	let buffer: string[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (buffer.length === 0) return;
		const items = buffer;
		buffer = [];
		void flushFn(items);
	}

	function add(item: string) {
		buffer.push(item);
		if (!timer) {
			timer = setTimeout(flush, windowMs);
		}
	}

	return { add, flush };
}

/** Tools that are too noisy for individual notifications. */
const QUIET_TOOLS = new Set(["read_file", "list_files", "list_directory"]);

/** Check if a tool should be notified about. */
export function shouldNotifyTool(toolName: string): boolean {
	return !QUIET_TOOLS.has(toolName);
}
