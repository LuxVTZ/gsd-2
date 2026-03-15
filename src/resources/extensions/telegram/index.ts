/**
 * Telegram Extension — GSD extension for remote monitoring and control via Telegram.
 *
 * Activation: Set GSD_TELEGRAM_TOKEN and GSD_TELEGRAM_OWNER_ID environment variables.
 * If not set, the extension silently skips (no error).
 *
 * Features:
 * - Session lifecycle notifications (start, end, compact, switch)
 * - Agent lifecycle notifications (thinking, done, error)
 * - Tool execution notifications with debouncing
 * - Agent message summaries
 * - /telegram slash command for status/disconnect
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { TelegramBotClient } from "./bot-client.js";
import {
	formatSessionStart,
	formatSessionEnd,
	formatCompaction,
	formatAgentStart,
	formatAgentEnd,
	formatToolStart,
	formatToolEnd,
	formatMessageSummary,
	splitMessage,
	createNotificationDebouncer,
	shouldNotifyTool,
} from "./notifications.js";
import { routeCommand, type CommandContext } from "./commands.js";
import { ApprovalManager } from "./inline-actions.js";
import { requiresApproval } from "./config.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("telegram");

export default function (pi: ExtensionAPI) {
	const token = process.env.GSD_TELEGRAM_TOKEN;
	const ownerId = process.env.GSD_TELEGRAM_OWNER_ID;

	if (!token || !ownerId) {
		logger.debug("Telegram extension: GSD_TELEGRAM_TOKEN or GSD_TELEGRAM_OWNER_ID not set, skipping");
		return;
	}

	let client: TelegramBotClient;
	try {
		client = new TelegramBotClient(token, ownerId);
	} catch (err) {
		logger.error(`Telegram extension init failed: ${(err as Error).message}`);
		return;
	}

	// Tool notification debouncer — batches rapid tool events
	const toolDebouncer = createNotificationDebouncer(async (items) => {
		const text = items.join("\n");
		for (const chunk of splitMessage(text)) {
			await client.sendMessage(chunk, { parseMode: "HTML" });
		}
	}, 500);

	// Approval manager for sensitive tool calls
	const approvalManager = new ApprovalManager(client);

	// Command context — updated on each session event
	let latestCtx: import("@gsd/pi-coding-agent").ExtensionContext | null = null;
	const cmdCtx: CommandContext = { pi, ctx: null, client };

	// Register incoming message handler for Telegram commands
	client.onMessage(async (text) => {
		cmdCtx.ctx = latestCtx;
		const response = await routeCommand(text, cmdCtx);
		await client.sendMessage(response, { parseMode: "HTML" });
	});

	// ─── Session lifecycle ──────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		client.start();
		const cwd = process.cwd();
		const model = ctx.model?.name;
		await client.sendMessage(formatSessionStart(cwd, model), { parseMode: "HTML" });
	});

	pi.on("session_shutdown", async () => {
		toolDebouncer.flush();
		approvalManager.cleanup();
		await client.sendMessage(formatSessionEnd(), { parseMode: "HTML" });
		await client.stop();
	});

	pi.on("session_compact", async () => {
		await client.sendMessage(formatCompaction(), { parseMode: "HTML" });
	});

	pi.on("session_switch", async () => {
		await client.sendMessage("🔀 Session switched", { parseMode: "HTML" });
	});

	// ─── Agent lifecycle ────────────────────────────────────────────

	pi.on("agent_start", async (_event, ctx) => {
		latestCtx = ctx;
		// No message — response will be sent on message_end
	});

	pi.on("agent_end", async (event) => {
		toolDebouncer.flush();
		// Only notify on error — success response already sent via message_end
		if (event.error) {
			await client.sendMessage(formatAgentEnd(false, String(event.error)), { parseMode: "HTML" });
		}
	});

	// ─── Tool approval gate ─────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!requiresApproval(event.toolName)) return;
		const approved = await approvalManager.requestApproval(
			event.toolName,
			(event.params ?? {}) as Record<string, unknown>,
		);
		if (!approved) {
			return { block: true, reason: "Rejected via Telegram" };
		}
	});

	// ─── Tool execution ─────────────────────────────────────────────

	pi.on("tool_execution_start", async (event) => {
		if (!shouldNotifyTool(event.toolName)) return;
		toolDebouncer.add(formatToolStart(event.toolName, event.params as Record<string, unknown> | undefined));
	});

	pi.on("tool_execution_end", async (event) => {
		if (!shouldNotifyTool(event.toolName)) return;
		toolDebouncer.add(formatToolEnd(event.toolName, !event.error));
	});

	// ─── Agent response → Telegram ─────────────────────────────────

	pi.on("message_end", async (event) => {
		const msg = event.message as { role?: string; content?: Array<{ type: string; text?: string }> };
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;

		const textParts = msg.content
			.filter((part) => part.type === "text" && part.text)
			.map((part) => part.text!);
		const fullText = textParts.join("");
		if (fullText.length < 10) return;

		const summary = formatMessageSummary(fullText);
		for (const chunk of splitMessage(summary)) {
			await client.sendMessage(chunk, { parseMode: "HTML" });
		}
	});

	// ─── /telegram command ──────────────────────────────────────────

	pi.registerCommand("telegram", {
		description: "Telegram bot status and control",
		handler: async (_args, ctx) => {
			const trimmed = _args.trim();

			if (trimmed === "disconnect" || trimmed === "stop") {
				toolDebouncer.flush();
				await client.sendMessage("🔌 Disconnecting from GSD...", { parseMode: "HTML" });
				await client.stop();
				ctx.ui.notify("Telegram bot disconnected.", "info");
				return;
			}

			// Default: status
			const status = client.isRunning ? "🟢 Connected" : "🔴 Disconnected";
			ctx.ui.notify(`Telegram: ${status}`, "info");
		},
	});

	logger.info("Telegram extension loaded");
}
