import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// ─── formatForTelegram / parseTelegramReply tests ───────────────────

import { formatForTelegram, parseTelegramReply } from "../resources/extensions/remote-questions/format.ts";
import type { RemotePrompt, RemoteQuestion } from "../resources/extensions/remote-questions/types.ts";

function makePrompt(questions: RemoteQuestion[]): RemotePrompt {
	return {
		id: "test-prompt",
		channel: "telegram",
		createdAt: Date.now(),
		timeoutAt: Date.now() + 300_000,
		pollIntervalMs: 5000,
		questions,
	};
}

function makeQuestion(overrides?: Partial<RemoteQuestion>): RemoteQuestion {
	return {
		id: "q1",
		header: "Choose framework",
		question: "Which framework should we use?",
		options: [
			{ label: "React", description: "Popular UI library" },
			{ label: "Vue", description: "Progressive framework" },
			{ label: "Svelte", description: "Compiler-based" },
		],
		allowMultiple: false,
		...overrides,
	};
}

describe("formatForTelegram", () => {
	it("formats single question with inline keyboard", () => {
		const prompt = makePrompt([makeQuestion()]);
		const { text, inlineKeyboard } = formatForTelegram(prompt);

		assert.ok(text.includes("GSD needs your input"));
		assert.ok(text.includes("Choose framework"));
		assert.ok(text.includes("React"));
		assert.ok(text.includes("Vue"));
		assert.ok(text.includes("Svelte"));
		assert.equal(inlineKeyboard.length, 3);
		assert.equal(inlineKeyboard[0][0].callback_data, "rq:q1:0");
		assert.equal(inlineKeyboard[1][0].callback_data, "rq:q1:1");
		assert.equal(inlineKeyboard[2][0].callback_data, "rq:q1:2");
	});

	it("escapes HTML special chars in text", () => {
		const q = makeQuestion({ header: "Use <b>bold</b> & stuff" });
		const prompt = makePrompt([q]);
		const { text } = formatForTelegram(prompt);

		assert.ok(text.includes("&lt;b&gt;bold&lt;/b&gt;"));
		assert.ok(text.includes("&amp;"));
	});

	it("shows multi-select hint for allowMultiple", () => {
		const q = makeQuestion({ allowMultiple: true });
		const prompt = makePrompt([q]);
		const { text } = formatForTelegram(prompt);

		assert.ok(text.includes("comma-separated"));
	});

	it("handles multiple questions", () => {
		const q1 = makeQuestion({ id: "q1" });
		const q2 = makeQuestion({ id: "q2", header: "Choose DB" });
		const prompt = makePrompt([q1, q2]);
		const { inlineKeyboard } = formatForTelegram(prompt);

		// 3 options per question = 6 rows
		assert.equal(inlineKeyboard.length, 6);
		assert.ok(inlineKeyboard[0][0].callback_data.startsWith("rq:q1:"));
		assert.ok(inlineKeyboard[3][0].callback_data.startsWith("rq:q2:"));
	});
});

describe("parseTelegramReply", () => {
	const questions = [makeQuestion()];

	it("parses callback data format", () => {
		const answer = parseTelegramReply("rq:q1:1", questions);
		assert.deepEqual(answer.answers["q1"].answers, ["Vue"]);
	});

	it("parses numeric text reply", () => {
		const answer = parseTelegramReply("2", questions);
		assert.deepEqual(answer.answers["q1"].answers, ["Vue"]);
	});

	it("parses comma-separated numbers", () => {
		const multiQ = [makeQuestion({ allowMultiple: true })];
		const answer = parseTelegramReply("1,3", multiQ);
		assert.deepEqual(answer.answers["q1"].answers, ["React", "Svelte"]);
	});

	it("returns user_note for free text", () => {
		const answer = parseTelegramReply("I prefer Angular actually", questions);
		assert.ok(answer.answers["q1"].user_note);
		assert.ok(answer.answers["q1"].user_note!.includes("Angular"));
	});

	it("handles out-of-range callback index gracefully", () => {
		const answer = parseTelegramReply("rq:q1:99", questions);
		// Falls through to text parsing since index is invalid
		assert.ok(answer.answers["q1"]);
	});

	it("handles unknown question ID in callback", () => {
		const answer = parseTelegramReply("rq:unknown:0", questions);
		assert.ok(answer.answers["q1"]);
	});
});

// ─── TelegramBotClient tests ───────────────────────────────────────

describe("TelegramBotClient", () => {
	it("rejects invalid owner ID", async () => {
		const { TelegramBotClient } = await import("../resources/extensions/telegram/bot-client.ts");
		assert.throws(() => new TelegramBotClient("fake:token", "not-a-number"), /Invalid Telegram owner ID/);
		assert.throws(() => new TelegramBotClient("fake:token", -5), /Invalid Telegram owner ID/);
		assert.throws(() => new TelegramBotClient("fake:token", 0), /Invalid Telegram owner ID/);
	});

	it("accepts valid numeric owner ID", async () => {
		const { TelegramBotClient } = await import("../resources/extensions/telegram/bot-client.ts");
		const client = new TelegramBotClient("fake:token", 123456789);
		assert.ok(client);
		assert.equal(client.isRunning, false);
	});

	it("accepts string owner ID", async () => {
		const { TelegramBotClient } = await import("../resources/extensions/telegram/bot-client.ts");
		const client = new TelegramBotClient("fake:token", "123456789");
		assert.ok(client);
	});
});

// ─── Config resolution tests ────────────────────────────────────────

describe("Telegram config resolution", () => {
	it("validates telegram channel ID pattern (positive)", async () => {
		const { isValidChannelId } = await import("../resources/extensions/remote-questions/config.ts");
		assert.ok(isValidChannelId("telegram", "123456789"));
		assert.ok(isValidChannelId("telegram", "-1001234567890"));
	});

	it("rejects invalid telegram channel IDs", async () => {
		const { isValidChannelId } = await import("../resources/extensions/remote-questions/config.ts");
		assert.ok(!isValidChannelId("telegram", "abc"));
		assert.ok(!isValidChannelId("telegram", ""));
		assert.ok(!isValidChannelId("telegram", "12345678901234567")); // too long
	});
});
