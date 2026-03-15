import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	escapeHtml,
	formatSessionStart,
	formatSessionEnd,
	formatCompaction,
	formatAgentStart,
	formatAgentEnd,
	formatToolStart,
	formatToolEnd,
	formatMessageSummary,
	splitMessage,
	truncate,
	createNotificationDebouncer,
	shouldNotifyTool,
} from "../resources/extensions/telegram/notifications.ts";

describe("Telegram notifications — escapeHtml", () => {
	it("escapes &, <, >", () => {
		assert.equal(escapeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
	});

	it("preserves safe text", () => {
		assert.equal(escapeHtml("hello world"), "hello world");
	});
});

describe("Telegram notifications — session formatting", () => {
	it("formats session start with workdir and model", () => {
		const msg = formatSessionStart("/home/user/project", "claude-sonnet");
		assert.ok(msg.includes("🟢"));
		assert.ok(msg.includes("/home/user/project"));
		assert.ok(msg.includes("claude-sonnet"));
	});

	it("formats session start without model", () => {
		const msg = formatSessionStart("/tmp");
		assert.ok(msg.includes("/tmp"));
		assert.ok(!msg.includes("🤖"));
	});

	it("formats session end", () => {
		const msg = formatSessionEnd();
		assert.ok(msg.includes("🔴"));
		assert.ok(msg.includes("ended"));
	});

	it("formats compaction with percent", () => {
		const msg = formatCompaction(85);
		assert.ok(msg.includes("📦"));
		assert.ok(msg.includes("85%"));
	});

	it("formats compaction without percent", () => {
		const msg = formatCompaction();
		assert.ok(msg.includes("compacted"));
		assert.ok(!msg.includes("%"));
	});
});

describe("Telegram notifications — agent formatting", () => {
	it("formats agent start", () => {
		assert.ok(formatAgentStart().includes("🧠"));
	});

	it("formats agent end success", () => {
		const msg = formatAgentEnd(true);
		assert.ok(msg.includes("✅"));
	});

	it("formats agent end with error", () => {
		const msg = formatAgentEnd(false, "rate limit exceeded");
		assert.ok(msg.includes("❌"));
		assert.ok(msg.includes("rate limit"));
	});

	it("escapes error HTML in agent end", () => {
		const msg = formatAgentEnd(false, "<script>alert(1)</script>");
		assert.ok(msg.includes("&lt;script&gt;"));
		assert.ok(!msg.includes("<script>"));
	});
});

describe("Telegram notifications — tool formatting", () => {
	it("formats tool start with command param", () => {
		const msg = formatToolStart("bash", { command: "npm test" });
		assert.ok(msg.includes("🔧"));
		assert.ok(msg.includes("bash"));
		assert.ok(msg.includes("npm test"));
	});

	it("formats tool start with path param", () => {
		const msg = formatToolStart("read_file", { path: "/src/index.ts" });
		assert.ok(msg.includes("/src/index.ts"));
	});

	it("formats tool start without params", () => {
		const msg = formatToolStart("custom_tool");
		assert.ok(msg.includes("custom_tool"));
	});

	it("truncates long command params", () => {
		const longCmd = "a".repeat(300);
		const msg = formatToolStart("bash", { command: longCmd });
		assert.ok(msg.length < 500);
		assert.ok(msg.includes("…"));
	});

	it("formats tool end success", () => {
		const msg = formatToolEnd("bash", true);
		assert.ok(msg.includes("✓"));
	});

	it("formats tool end failure", () => {
		const msg = formatToolEnd("bash", false);
		assert.ok(msg.includes("✗"));
	});
});

describe("Telegram notifications — message summary", () => {
	it("wraps text in pre tags", () => {
		const msg = formatMessageSummary("Hello world");
		assert.ok(msg.includes("<pre>"));
	});

	it("includes token usage", () => {
		const msg = formatMessageSummary("test", { input: 1000, output: 500 });
		assert.ok(msg.includes("📊"));
		assert.ok(msg.includes("1000"));
		assert.ok(msg.includes("500"));
	});

	it("truncates very long messages", () => {
		const long = "x".repeat(5000);
		const msg = formatMessageSummary(long);
		assert.ok(msg.length < 4500);
	});
});

describe("Telegram notifications — splitMessage", () => {
	it("returns single chunk for short message", () => {
		const chunks = splitMessage("hello");
		assert.equal(chunks.length, 1);
	});

	it("splits long message into multiple chunks", () => {
		const long = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n");
		const chunks = splitMessage(long, 200);
		assert.ok(chunks.length > 1);
		for (const chunk of chunks) {
			assert.ok(chunk.length <= 200);
		}
	});
});

describe("Telegram notifications — truncate", () => {
	it("preserves short text", () => {
		assert.equal(truncate("hi", 10), "hi");
	});

	it("truncates and appends ellipsis", () => {
		const result = truncate("hello world", 6);
		assert.equal(result.length, 6);
		assert.ok(result.endsWith("…"));
	});
});

describe("Telegram notifications — debouncer", () => {
	it("batches items and flushes", async () => {
		let flushed: string[] = [];
		const debouncer = createNotificationDebouncer((items) => {
			flushed = items;
		}, 50);

		debouncer.add("a");
		debouncer.add("b");
		debouncer.add("c");

		// Manual flush
		debouncer.flush();
		assert.deepEqual(flushed, ["a", "b", "c"]);
	});

	it("flush with empty buffer does nothing", () => {
		let called = false;
		const debouncer = createNotificationDebouncer(() => {
			called = true;
		}, 50);
		debouncer.flush();
		assert.equal(called, false);
	});
});

describe("Telegram notifications — shouldNotifyTool", () => {
	it("filters quiet tools", () => {
		assert.equal(shouldNotifyTool("read_file"), false);
		assert.equal(shouldNotifyTool("list_files"), false);
	});

	it("allows noisy tools", () => {
		assert.equal(shouldNotifyTool("bash"), true);
		assert.equal(shouldNotifyTool("write_file"), true);
		assert.equal(shouldNotifyTool("edit_file"), true);
	});
});
