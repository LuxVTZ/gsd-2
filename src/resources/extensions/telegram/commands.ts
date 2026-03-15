/**
 * Telegram Commands — routes incoming Telegram messages to GSD actions.
 *
 * Supports:
 * - /status — session info
 * - /stop — abort current agent
 * - /compact — trigger compaction
 * - /tools — list active tools
 * - /approve <level> — change approval sensitivity
 * - /help — list commands
 * - Free text → inject as user message
 */

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import type { TelegramBotClient } from "./bot-client.js";
import { escapeHtml } from "./notifications.js";
import { getApproveLevel, setApproveLevel, type ApproveLevel, APPROVE_LEVELS } from "./config.js";

export interface CommandContext {
	pi: ExtensionAPI;
	ctx: ExtensionContext | null;
	client: TelegramBotClient;
}

interface CommandDef {
	description: string;
	handler: (args: string, cmdCtx: CommandContext) => Promise<string>;
}

const COMMANDS: Record<string, CommandDef> = {
	"/status": {
		description: "Session status, model, context usage",
		handler: async (_args, { ctx }) => {
			if (!ctx) return "⚠️ No active session context";
			const lines: string[] = ["📊 <b>Status</b>"];
			const name = ctx.getSessionName?.();
			if (name) lines.push(`Session: ${escapeHtml(name)}`);
			lines.push(`Model: ${escapeHtml(ctx.model?.name ?? "unknown")}`);
			const usage = ctx.getContextUsage?.();
			if (usage) lines.push(`Context: ${usage.percent}% (${usage.tokens}/${usage.contextWindow})`);
			lines.push(`State: ${ctx.isIdle() ? "💤 Idle" : "⚡ Working"}`);
			return lines.join("\n");
		},
	},
	"/stop": {
		description: "Abort current agent operation",
		handler: async (_args, { ctx }) => {
			if (!ctx) return "⚠️ No active session context";
			if (ctx.isIdle()) return "💤 Agent is already idle";
			ctx.abort();
			return "🛑 Abort signal sent";
		},
	},
	"/compact": {
		description: "Trigger context compaction",
		handler: async (_args, { ctx }) => {
			if (!ctx) return "⚠️ No active session context";
			await ctx.compact();
			return "📦 Compaction triggered";
		},
	},
	"/tools": {
		description: "List active tools",
		handler: async (_args, { pi }) => {
			const tools = pi.getActiveTools();
			if (tools.length === 0) return "No active tools";
			return `🔧 <b>Active tools (${tools.length}):</b>\n${tools.map((t) => `• ${escapeHtml(t)}`).join("\n")}`;
		},
	},
	"/approve": {
		description: "Set approval level: all | destructive | none",
		handler: async (args, _cmdCtx) => {
			const level = args.trim().toLowerCase();
			if (!level) {
				return `Current approval level: <b>${getApproveLevel()}</b>\nOptions: ${APPROVE_LEVELS.join(", ")}`;
			}
			if (!APPROVE_LEVELS.includes(level as ApproveLevel)) {
				return `❌ Unknown level. Options: ${APPROVE_LEVELS.join(", ")}`;
			}
			setApproveLevel(level as ApproveLevel);
			return `✅ Approval level set to <b>${level}</b>`;
		},
	},
	"/help": {
		description: "List available commands",
		handler: async () => {
			const lines = ["📋 <b>Available commands:</b>"];
			for (const [cmd, def] of Object.entries(COMMANDS)) {
				lines.push(`${cmd} — ${escapeHtml(def.description)}`);
			}
			lines.push("\nFree text → sent as user message to GSD");
			return lines.join("\n");
		},
	},
};

/**
 * Route an incoming Telegram message to the appropriate handler.
 * Returns the response text to send back.
 */
export async function routeCommand(text: string, cmdCtx: CommandContext): Promise<string> {
	const trimmed = text.trim();

	// Check for known commands
	for (const [cmd, def] of Object.entries(COMMANDS)) {
		if (trimmed === cmd || trimmed.startsWith(cmd + " ")) {
			const args = trimmed.slice(cmd.length).trim();
			return def.handler(args, cmdCtx);
		}
	}

	// Also handle commands without slash (e.g. "status", "stop")
	const word = trimmed.split(/\s+/)[0].toLowerCase();
	if (COMMANDS["/" + word]) {
		const args = trimmed.slice(word.length).trim();
		return COMMANDS["/" + word].handler(args, cmdCtx);
	}

	// Free text → inject as user message
	cmdCtx.pi.sendUserMessage(trimmed);
	return `📨 Sent to GSD: "${escapeHtml(trimmed.length > 100 ? trimmed.slice(0, 100) + "…" : trimmed)}"`;
}

/** Get list of command names for external use. */
export function getCommandList(): string[] {
	return Object.keys(COMMANDS);
}
