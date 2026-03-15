/**
 * Telegram Inline Actions — approval flow for sensitive tool calls via inline keyboard.
 *
 * When a tool call requires approval, sends an inline keyboard message to Telegram.
 * The user can [✅ Approve] [❌ Reject] [📋 Details].
 * Pending confirmations time out after a configurable period.
 */

import type { TelegramBotClient, InlineButton } from "./bot-client.js";
import { escapeHtml, truncate } from "./notifications.js";
import { requiresApproval } from "./config.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("telegram-approval");

export interface PendingApproval {
	id: string;
	toolName: string;
	params: Record<string, unknown>;
	resolve: (approved: boolean) => void;
	timeout: ReturnType<typeof setTimeout>;
	messageId?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalManager {
	private pending = new Map<string, PendingApproval>();
	private client: TelegramBotClient;
	private timeoutMs: number;
	private nextId = 0;

	constructor(client: TelegramBotClient, timeoutMs = DEFAULT_TIMEOUT_MS) {
		this.client = client;
		this.timeoutMs = timeoutMs;
		this.setupCallbackHandler();
	}

	private setupCallbackHandler(): void {
		this.client.onCallback(async (data, _chatId, _messageId) => {
			const match = data.match(/^(approve|reject|details):(.+)$/);
			if (!match) return;

			const [, action, id] = match;
			const pending = this.pending.get(id);
			if (!pending) {
				logger.debug(`No pending approval for id: ${id}`);
				return;
			}

			if (action === "details") {
				const details = formatToolDetails(pending.toolName, pending.params);
				await this.client.sendMessage(details, { parseMode: "HTML" });
				return;
			}

			const approved = action === "approve";
			this.resolve(id, approved);

			const emoji = approved ? "✅" : "❌";
			const verb = approved ? "Approved" : "Rejected";
			await this.client.sendMessage(
				`${emoji} <b>${verb}:</b> ${escapeHtml(pending.toolName)}`,
				{ parseMode: "HTML" },
			);
		});
	}

	/**
	 * Check if a tool call needs approval and, if so, request it via Telegram.
	 * Returns true if approved (or no approval needed), false if rejected/timed out.
	 */
	async requestApproval(toolName: string, params: Record<string, unknown>): Promise<boolean> {
		if (!requiresApproval(toolName)) return true;

		const id = String(++this.nextId);

		return new Promise<boolean>((resolve) => {
			const timeout = setTimeout(() => {
				this.resolve(id, false);
				void this.client.sendMessage(
					`⏰ <b>Timed out:</b> ${escapeHtml(toolName)} — auto-rejected after ${this.timeoutMs / 1000}s`,
					{ parseMode: "HTML" },
				);
			}, this.timeoutMs);

			const pending: PendingApproval = { id, toolName, params, resolve, timeout };
			this.pending.set(id, pending);

			void this.sendApprovalRequest(pending);
		});
	}

	private async sendApprovalRequest(pending: PendingApproval): Promise<void> {
		const brief = formatToolBrief(pending.toolName, pending.params);
		const text = `⚠️ <b>Approval required</b>\n\n🔧 <b>${escapeHtml(pending.toolName)}</b>\n${brief}`;

		const buttons: InlineButton[][] = [
			[
				{ text: "✅ Approve", callbackData: `approve:${pending.id}` },
				{ text: "❌ Reject", callbackData: `reject:${pending.id}` },
				{ text: "📋 Details", callbackData: `details:${pending.id}` },
			],
		];

		const msg = await this.client.sendButtons(text, buttons, { parseMode: "HTML" });
		if (msg) pending.messageId = msg.message_id;
	}

	private resolve(id: string, approved: boolean): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.pending.delete(id);
		pending.resolve(approved);
	}

	/** Get count of pending approvals. */
	get pendingCount(): number {
		return this.pending.size;
	}

	/** Clean up all pending approvals (e.g. on shutdown). */
	cleanup(): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.resolve(false);
			this.pending.delete(id);
		}
	}
}

function formatToolBrief(toolName: string, params: Record<string, unknown>): string {
	if (typeof params.command === "string") {
		return `<code>${escapeHtml(truncate(params.command, 300))}</code>`;
	}
	if (typeof params.path === "string") {
		return `📄 ${escapeHtml(params.path as string)}`;
	}
	const keys = Object.keys(params);
	if (keys.length === 0) return "(no params)";
	return keys.slice(0, 5).map((k) => `${k}: ${escapeHtml(truncate(String(params[k]), 100))}`).join("\n");
}

function formatToolDetails(toolName: string, params: Record<string, unknown>): string {
	const lines = [`📋 <b>Tool details: ${escapeHtml(toolName)}</b>\n`];
	for (const [key, value] of Object.entries(params)) {
		const val = typeof value === "string" ? value : JSON.stringify(value);
		lines.push(`<b>${escapeHtml(key)}:</b>`);
		lines.push(`<pre>${escapeHtml(truncate(val, 1000))}</pre>`);
	}
	return lines.join("\n");
}
