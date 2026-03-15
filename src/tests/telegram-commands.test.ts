import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
	getApproveLevel,
	setApproveLevel,
	resetApproveLevel,
	requiresApproval,
	APPROVE_LEVELS,
	getTelegramConfig,
} from "../resources/extensions/telegram/config.ts";

import { routeCommand, getCommandList } from "../resources/extensions/telegram/commands.ts";

// ─── Config tests ───────────────────────────────────────────────────

describe("Telegram config — approval levels", () => {
	beforeEach(() => resetApproveLevel());
	afterEach(() => resetApproveLevel());

	it("defaults to destructive", () => {
		assert.equal(getApproveLevel(), "destructive");
	});

	it("can be set and read", () => {
		setApproveLevel("all");
		assert.equal(getApproveLevel(), "all");
		setApproveLevel("none");
		assert.equal(getApproveLevel(), "none");
	});

	it("resets to default", () => {
		setApproveLevel("all");
		resetApproveLevel();
		assert.equal(getApproveLevel(), "destructive");
	});

	it("reads from env when not explicitly set", () => {
		const prev = process.env.GSD_TELEGRAM_APPROVE;
		process.env.GSD_TELEGRAM_APPROVE = "none";
		resetApproveLevel();
		assert.equal(getApproveLevel(), "none");
		if (prev === undefined) delete process.env.GSD_TELEGRAM_APPROVE;
		else process.env.GSD_TELEGRAM_APPROVE = prev;
	});
});

describe("Telegram config — requiresApproval", () => {
	beforeEach(() => resetApproveLevel());
	afterEach(() => resetApproveLevel());

	it("approves everything in 'all' mode", () => {
		setApproveLevel("all");
		assert.equal(requiresApproval("bash"), true);
		assert.equal(requiresApproval("read_file"), true);
		assert.equal(requiresApproval("custom_tool"), true);
	});

	it("approves nothing in 'none' mode", () => {
		setApproveLevel("none");
		assert.equal(requiresApproval("bash"), false);
		assert.equal(requiresApproval("write_file"), false);
	});

	it("approves only destructive tools in 'destructive' mode", () => {
		setApproveLevel("destructive");
		assert.equal(requiresApproval("bash"), true);
		assert.equal(requiresApproval("write_file"), true);
		assert.equal(requiresApproval("edit_file"), true);
		assert.equal(requiresApproval("read_file"), false);
		assert.equal(requiresApproval("list_files"), false);
	});
});

describe("Telegram config — getTelegramConfig", () => {
	it("returns null when env vars not set", () => {
		const prevToken = process.env.GSD_TELEGRAM_TOKEN;
		const prevId = process.env.GSD_TELEGRAM_OWNER_ID;
		delete process.env.GSD_TELEGRAM_TOKEN;
		delete process.env.GSD_TELEGRAM_OWNER_ID;

		assert.equal(getTelegramConfig(), null);

		if (prevToken) process.env.GSD_TELEGRAM_TOKEN = prevToken;
		if (prevId) process.env.GSD_TELEGRAM_OWNER_ID = prevId;
	});

	it("returns config when env vars are set", () => {
		const prevToken = process.env.GSD_TELEGRAM_TOKEN;
		const prevId = process.env.GSD_TELEGRAM_OWNER_ID;
		process.env.GSD_TELEGRAM_TOKEN = "test:token";
		process.env.GSD_TELEGRAM_OWNER_ID = "123456";

		const cfg = getTelegramConfig();
		assert.ok(cfg);
		assert.equal(cfg.token, "test:token");
		assert.equal(cfg.ownerId, "123456");

		if (prevToken === undefined) delete process.env.GSD_TELEGRAM_TOKEN;
		else process.env.GSD_TELEGRAM_TOKEN = prevToken;
		if (prevId === undefined) delete process.env.GSD_TELEGRAM_OWNER_ID;
		else process.env.GSD_TELEGRAM_OWNER_ID = prevId;
	});
});

// ─── Command routing tests ──────────────────────────────────────────

describe("Telegram commands — routeCommand", () => {
	// Mock command context
	function makeCmdCtx(): any {
		const sentMessages: string[] = [];
		return {
			pi: {
				getActiveTools: () => ["bash", "read_file", "write_file"],
				sendUserMessage: (text: string) => sentMessages.push(text),
			},
			ctx: {
				model: { name: "claude-sonnet" },
				isIdle: () => true,
				abort: () => {},
				compact: async () => {},
				getSessionName: () => "test-session",
				getContextUsage: () => ({ percent: 42, tokens: 5000, contextWindow: 12000 }),
			},
			client: { sendMessage: async () => null },
			_sentMessages: sentMessages,
		};
	}

	it("routes /status command", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/status", cmdCtx);
		assert.ok(result.includes("Status"));
		assert.ok(result.includes("claude-sonnet"));
		assert.ok(result.includes("42%"));
		assert.ok(result.includes("Idle"));
	});

	it("routes /tools command", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/tools", cmdCtx);
		assert.ok(result.includes("bash"));
		assert.ok(result.includes("read_file"));
	});

	it("routes /help command", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/help", cmdCtx);
		assert.ok(result.includes("/status"));
		assert.ok(result.includes("/stop"));
		assert.ok(result.includes("/tools"));
	});

	it("routes /stop when idle", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/stop", cmdCtx);
		assert.ok(result.includes("idle"));
	});

	it("routes /approve with level", async () => {
		resetApproveLevel();
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/approve none", cmdCtx);
		assert.ok(result.includes("none"));
		resetApproveLevel();
	});

	it("routes /approve without args shows current", async () => {
		resetApproveLevel();
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/approve", cmdCtx);
		assert.ok(result.includes("destructive"));
		resetApproveLevel();
	});

	it("routes free text as user message", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("fix the login bug", cmdCtx);
		assert.ok(result.includes("Sent to GSD"));
		assert.deepEqual(cmdCtx._sentMessages, ["fix the login bug"]);
	});

	it("handles command without slash", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("status", cmdCtx);
		assert.ok(result.includes("Status"));
	});

	it("handles /status without ctx", async () => {
		const cmdCtx = makeCmdCtx();
		cmdCtx.ctx = null;
		const result = await routeCommand("/status", cmdCtx);
		assert.ok(result.includes("No active session"));
	});

	it("handles /compact", async () => {
		const cmdCtx = makeCmdCtx();
		const result = await routeCommand("/compact", cmdCtx);
		assert.ok(result.includes("Compaction"));
	});
});

describe("Telegram commands — getCommandList", () => {
	it("returns all command names", () => {
		const cmds = getCommandList();
		assert.ok(cmds.includes("/status"));
		assert.ok(cmds.includes("/stop"));
		assert.ok(cmds.includes("/help"));
		assert.ok(cmds.includes("/tools"));
		assert.ok(cmds.includes("/approve"));
	});
});

// ─── APPROVE_LEVELS constant ────────────────────────────────────────

describe("APPROVE_LEVELS", () => {
	it("has exactly 3 levels", () => {
		assert.equal(APPROVE_LEVELS.length, 3);
		assert.ok(APPROVE_LEVELS.includes("all"));
		assert.ok(APPROVE_LEVELS.includes("destructive"));
		assert.ok(APPROVE_LEVELS.includes("none"));
	});
});
