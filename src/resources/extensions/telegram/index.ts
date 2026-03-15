/**
 * Telegram Extension — beautiful notifications for GSD via Telegram.
 *
 * Activation: Set GSD_TELEGRAM_TOKEN and GSD_TELEGRAM_OWNER_ID environment variables.
 * If not set, the extension silently skips (no error).
 *
 * The agent is fully autonomous — no approvals, no blocking.
 * Telegram is purely a notification + command channel.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { TelegramBotClient } from "./bot-client.js";
import {
splitMessage,
shouldNotifyTool,
truncate,
escapeHtml,
} from "./notifications.js";
import { routeCommand, type CommandContext } from "./commands.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("telegram");

export default function (pi: ExtensionAPI) {
const token = process.env.GSD_TELEGRAM_TOKEN;
const ownerId = process.env.GSD_TELEGRAM_OWNER_ID;

if (!token || !ownerId) {
logger.debug("Telegram: not configured, skipping");
return;
}

let client: TelegramBotClient;
try {
client = new TelegramBotClient(token, ownerId);
} catch (err) {
logger.error(`Telegram init failed: ${(err as Error).message}`);
return;
}

// Collect tool events, flush as a single pretty message
const toolBatch: string[] = [];
let toolFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushToolBatch() {
if (toolFlushTimer) { clearTimeout(toolFlushTimer); toolFlushTimer = null; }
if (toolBatch.length === 0) return;
const lines = toolBatch.splice(0);
const msg = lines.join("\n");
for (const chunk of splitMessage(msg)) {
void client.sendMessage(chunk, { parseMode: "HTML", disableNotification: true });
}
}

function addToolEvent(line: string) {
toolBatch.push(line);
if (!toolFlushTimer) {
toolFlushTimer = setTimeout(flushToolBatch, 800);
}
}

// Command context
let latestCtx: import("@gsd/pi-coding-agent").ExtensionContext | null = null;
const cmdCtx: CommandContext = { pi, ctx: null, client };

client.onMessage(async (text) => {
cmdCtx.ctx = latestCtx;
const response = await routeCommand(text, cmdCtx);
await client.sendMessage(response, { parseMode: "HTML" });
});

// ─── Session lifecycle ──────────────────────────────────────────

pi.on("session_start", async (_event, ctx) => {
latestCtx = ctx;
client.start();
const cwd = process.cwd().replace(/^\/home\/[^/]+/, "~");
const model = ctx.model?.name ?? "unknown";
await client.sendMessage(
`🟢 <b>GSD запущен</b>\n\n` +
`📂 <code>${escapeHtml(cwd)}</code>\n` +
`🤖 <code>${escapeHtml(model)}</code>`,
{ parseMode: "HTML" },
);
});

pi.on("session_shutdown", async () => {
flushToolBatch();
await client.sendMessage("🔴 <b>GSD завершён</b>", { parseMode: "HTML" });
await client.stop();
});

pi.on("session_compact", async () => {
await client.sendMessage("📦 Контекст сжат", { parseMode: "HTML", disableNotification: true });
});

// ─── Agent lifecycle ────────────────────────────────────────────

pi.on("agent_start", async (_event, ctx) => {
latestCtx = ctx;
});

pi.on("agent_end", async (event) => {
flushToolBatch();
if (event.error) {
await client.sendMessage(
`❌ <b>Ошибка агента</b>\n<pre>${escapeHtml(truncate(String(event.error), 500))}</pre>`,
{ parseMode: "HTML" },
);
}
});

// ─── Tool execution (notifications only, no blocking) ───────────

pi.on("tool_execution_start", async (event) => {
if (!shouldNotifyTool(event.toolName)) return;
const params = event.params as Record<string, unknown> | undefined;
let detail = "";
if (params?.command && typeof params.command === "string") {
detail = `  <code>${escapeHtml(truncate(params.command, 120))}</code>`;
} else if (params?.path && typeof params.path === "string") {
detail = `  <code>${escapeHtml(truncate(String(params.path), 120))}</code>`;
}
addToolEvent(`⚙️ <b>${escapeHtml(event.toolName)}</b>${detail}`);
});

pi.on("tool_execution_end", async (event) => {
if (!shouldNotifyTool(event.toolName)) return;
const icon = event.error ? "✗" : "✓";
addToolEvent(`  ${icon} ${escapeHtml(event.toolName)}`);
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

const trimmed = truncate(fullText, 3800);
const formatted = `💬 <b>GSD</b>\n\n${escapeHtml(trimmed)}`;

for (const chunk of splitMessage(formatted)) {
await client.sendMessage(chunk, { parseMode: "HTML" });
}
});

// ─── /telegram command ──────────────────────────────────────────

pi.registerCommand("telegram", {
description: "Telegram bot status and control",
handler: async (_args, ctx) => {
const trimmed = _args.trim();
if (trimmed === "disconnect" || trimmed === "stop") {
flushToolBatch();
await client.sendMessage("🔌 Отключаюсь...", { parseMode: "HTML" });
await client.stop();
ctx.ui.notify("Telegram bot disconnected.", "info");
return;
}
const status = client.isRunning ? "�� Подключён" : "🔴 Отключён";
ctx.ui.notify(`Telegram: ${status}`, "info");
},
});

logger.debug("Telegram extension loaded");
}
