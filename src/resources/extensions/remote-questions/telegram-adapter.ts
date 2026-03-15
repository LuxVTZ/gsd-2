/**
 * Remote Questions — Telegram adapter
 *
 * Implements ChannelAdapter using Telegram Bot API via grammy.
 * Questions are sent as messages with inline keyboard buttons.
 * Answers come back as callback queries or text replies.
 */

import type { ChannelAdapter, RemotePrompt, RemoteDispatchResult, RemoteAnswer, RemotePromptRef } from "./types.js";
import { formatForTelegram, parseTelegramReply } from "./format.js";

const TELEGRAM_API = "https://api.telegram.org";
const PER_REQUEST_TIMEOUT_MS = 15_000;

export class TelegramAdapter implements ChannelAdapter {
	readonly name = "telegram" as const;
	private readonly token: string;
	private readonly chatId: string;
	private lastUpdateId = 0;

	constructor(token: string, chatId: string) {
		this.token = token;
		this.chatId = chatId;
	}

	async validate(): Promise<void> {
		const res = await this.telegramApi("getMe");
		if (!res.ok) throw new Error(`Telegram auth failed: ${res.description ?? "invalid token"}`);
	}

	async sendPrompt(prompt: RemotePrompt): Promise<RemoteDispatchResult> {
		const { text, inlineKeyboard } = formatForTelegram(prompt);

		const body: Record<string, unknown> = {
			chat_id: this.chatId,
			text,
			parse_mode: "HTML",
		};

		if (inlineKeyboard.length > 0) {
			body.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
		}

		const res = await this.telegramApi("sendMessage", body);
		if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.description ?? "unknown"}`);

		const messageId = String(res.result.message_id);

		return {
			ref: {
				id: prompt.id,
				channel: "telegram",
				messageId,
				channelId: this.chatId,
			},
		};
	}

	async pollAnswer(prompt: RemotePrompt, ref: RemotePromptRef): Promise<RemoteAnswer | null> {
		// Check for callback queries (button presses)
		const callbackAnswer = await this.checkCallbackQueries(prompt, ref);
		if (callbackAnswer) return callbackAnswer;

		// Check for text replies
		return this.checkTextReplies(prompt, ref);
	}

	private async checkCallbackQueries(prompt: RemotePrompt, _ref: RemotePromptRef): Promise<RemoteAnswer | null> {
		const res = await this.telegramApi("getUpdates", {
			offset: this.lastUpdateId + 1,
			timeout: 0,
			allowed_updates: JSON.stringify(["callback_query", "message"]),
		});

		if (!res.ok || !Array.isArray(res.result)) return null;

		for (const update of res.result) {
			this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

			if (update.callback_query?.data) {
				const data = String(update.callback_query.data);
				const fromId = String(update.callback_query.from?.id ?? "");

				if (fromId !== this.chatId) continue;

				// Answer callback to remove loading state
				try {
					await this.telegramApi("answerCallbackQuery", {
						callback_query_id: update.callback_query.id,
					});
				} catch {
					// Best-effort
				}

				return parseTelegramReply(data, prompt.questions);
			}
		}

		return null;
	}

	private async checkTextReplies(prompt: RemotePrompt, ref: RemotePromptRef): Promise<RemoteAnswer | null> {
		const res = await this.telegramApi("getUpdates", {
			offset: this.lastUpdateId + 1,
			timeout: 0,
			allowed_updates: JSON.stringify(["message"]),
		});

		if (!res.ok || !Array.isArray(res.result)) return null;

		for (const update of res.result) {
			this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

			if (update.message?.text && update.message.reply_to_message?.message_id === parseInt(ref.messageId, 10)) {
				const fromId = String(update.message.from?.id ?? "");
				if (fromId !== this.chatId) continue;

				return parseTelegramReply(update.message.text, prompt.questions);
			}
		}

		return null;
	}

	private async telegramApi(method: string, params?: Record<string, unknown>): Promise<Record<string, any>> {
		const url = `${TELEGRAM_API}/bot${this.token}/${method}`;

		let response: Response;
		if (!params || Object.keys(params).length === 0) {
			response = await fetch(url, {
				method: "GET",
				signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
			});
		} else {
			response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
				signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
			});
		}

		return response.json() as Promise<Record<string, any>>;
	}
}
