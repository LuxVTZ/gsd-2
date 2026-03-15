/**
 * Telegram Bot Client — grammy wrapper with owner-only access and graceful error handling.
 *
 * All Telegram interactions go through this client. It ensures:
 * - Only the configured owner can interact with the bot
 * - Network failures don't crash GSD
 * - Clean start/stop lifecycle
 */

import { Bot, InlineKeyboard, GrammyError, HttpError } from "grammy";
import type { Message } from "grammy/types";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("telegram");

export interface InlineButton {
	text: string;
	callbackData: string;
}

export interface SendMessageOptions {
	parseMode?: "MarkdownV2" | "HTML";
	disableNotification?: boolean;
	replyMarkup?: InlineKeyboard;
}

export type MessageHandler = (text: string, chatId: number) => void | Promise<void>;
export type CallbackHandler = (data: string, chatId: number, messageId: number) => void | Promise<void>;

export class TelegramBotClient {
	private bot: Bot;
	private readonly ownerId: number;
	private running = false;
	private messageHandlers: MessageHandler[] = [];
	private callbackHandlers: CallbackHandler[] = [];

	constructor(token: string, ownerId: number | string) {
		this.ownerId = typeof ownerId === "string" ? parseInt(ownerId, 10) : ownerId;
		if (!Number.isFinite(this.ownerId) || this.ownerId <= 0) {
			throw new Error("Invalid Telegram owner ID");
		}

		this.bot = new Bot(token);
		this.setupMiddleware();
	}

	private setupMiddleware(): void {
		// Owner-only filter — ignore all messages from non-owner users
		this.bot.use(async (ctx, next) => {
			const fromId = ctx.from?.id;
			if (fromId !== this.ownerId) {
				logger.debug(`Ignoring message from non-owner: ${fromId}`);
				return;
			}
			await next();
		});

		// Text message handler
		this.bot.on("message:text", async (ctx) => {
			const text = ctx.message.text;
			const chatId = ctx.chat.id;
			for (const handler of this.messageHandlers) {
				try {
					await handler(text, chatId);
				} catch (err) {
					logger.error(`Message handler error: ${(err as Error).message}`);
				}
			}
		});

		// Callback query handler (inline buttons)
		this.bot.on("callback_query:data", async (ctx) => {
			const data = ctx.callbackQuery.data;
			const chatId = ctx.chat?.id ?? this.ownerId;
			const messageId = ctx.callbackQuery.message?.message_id ?? 0;
			try {
				await ctx.answerCallbackQuery();
			} catch {
				// Best-effort answer
			}
			for (const handler of this.callbackHandlers) {
				try {
					await handler(data, chatId, messageId);
				} catch (err) {
					logger.error(`Callback handler error: ${(err as Error).message}`);
				}
			}
		});

		// Global error handler — never crash GSD
		this.bot.catch((err) => {
			if (err.error instanceof GrammyError) {
				logger.error(`Telegram API error: ${err.error.description}`);
			} else if (err.error instanceof HttpError) {
				logger.error(`Telegram HTTP error: ${err.error.message}`);
			} else {
				logger.error(`Telegram bot error: ${String(err.error)}`);
			}
		});
	}

	/** Start long-polling (non-blocking). */
	start(): void {
		if (this.running) return;
		this.running = true;
		// Fire-and-forget — bot.start() runs its own polling loop
		this.bot.start({
			onStart: () => logger.debug("Telegram bot started"),
			allowed_updates: ["message", "callback_query"],
		});
		logger.debug("Telegram bot polling started");
	}

	/** Stop the bot gracefully. */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		try {
			await this.bot.stop();
			logger.debug("Telegram bot stopped");
		} catch (err) {
			logger.error(`Error stopping bot: ${(err as Error).message}`);
		}
	}

	get isRunning(): boolean {
		return this.running;
	}

	/** Send a text message to the owner. */
	async sendMessage(text: string, opts?: SendMessageOptions): Promise<Message.TextMessage | null> {
		try {
			return await this.bot.api.sendMessage(this.ownerId, text, {
				parse_mode: opts?.parseMode,
				disable_notification: opts?.disableNotification,
				reply_markup: opts?.replyMarkup,
			});
		} catch (err) {
			logger.error(`Failed to send message: ${(err as Error).message}`);
			return null;
		}
	}

	/** Send a message with inline keyboard buttons. */
	async sendButtons(text: string, buttons: InlineButton[][], opts?: Omit<SendMessageOptions, "replyMarkup">): Promise<Message.TextMessage | null> {
		const keyboard = new InlineKeyboard();
		for (const row of buttons) {
			for (const btn of row) {
				keyboard.text(btn.text, btn.callbackData);
			}
			keyboard.row();
		}
		return this.sendMessage(text, { ...opts, replyMarkup: keyboard });
	}

	/** Edit an existing message text. */
	async editMessage(chatId: number, messageId: number, text: string, opts?: Pick<SendMessageOptions, "parseMode">): Promise<boolean> {
		try {
			await this.bot.api.editMessageText(chatId, messageId, text, {
				parse_mode: opts?.parseMode,
			});
			return true;
		} catch (err) {
			logger.error(`Failed to edit message: ${(err as Error).message}`);
			return false;
		}
	}

	/** Register a handler for incoming text messages (owner-only). */
	onMessage(handler: MessageHandler): void {
		this.messageHandlers.push(handler);
	}

	/** Register a handler for callback queries (inline button presses, owner-only). */
	onCallback(handler: CallbackHandler): void {
		this.callbackHandlers.push(handler);
	}

	/** Validate the bot token by calling getMe. Returns bot username. */
	async validate(): Promise<string> {
		const me = await this.bot.api.getMe();
		return me.username;
	}

	/** Access the underlying grammy Bot API for advanced use. */
	get api() {
		return this.bot.api;
	}
}
