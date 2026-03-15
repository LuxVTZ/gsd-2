import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	TokenBucket,
	MessageQueue,
} from "../resources/extensions/telegram/rate-limiter.ts";

import {
	escapeMdV2,
	escapeHtmlTg,
	codeBlock,
	inlineCode,
	progressBar,
	statusCard,
	spoiler,
	formatDiff,
	safeTruncate,
} from "../resources/extensions/telegram/formatter.ts";

// ─── TokenBucket tests ─────────────────────────────────────────────

describe("TokenBucket", () => {
	it("allows consumption up to max tokens", () => {
		const bucket = new TokenBucket(3, 10);
		assert.equal(bucket.tryConsume(), true);
		assert.equal(bucket.tryConsume(), true);
		assert.equal(bucket.tryConsume(), true);
		assert.equal(bucket.tryConsume(), false);
	});

	it("reports wait time when empty", () => {
		const bucket = new TokenBucket(1, 10);
		bucket.tryConsume();
		const wait = bucket.waitTime();
		assert.ok(wait > 0);
		assert.ok(wait <= 200); // ~100ms for 10 tokens/s
	});

	it("reports zero wait when tokens available", () => {
		const bucket = new TokenBucket(5, 10);
		assert.equal(bucket.waitTime(), 0);
	});

	it("reports available tokens", () => {
		const bucket = new TokenBucket(5, 10);
		assert.equal(bucket.available, 5);
		bucket.tryConsume();
		assert.equal(bucket.available, 4);
	});
});

// ─── MessageQueue tests ────────────────────────────────────────────

describe("MessageQueue", () => {
	it("enqueues and dequeues in priority order", () => {
		const q = new MessageQueue();
		q.enqueue("low", "notification");
		q.enqueue("high", "command");
		q.enqueue("mid", "approval");

		const first = q.dequeue();
		assert.equal(first?.text, "high");
		assert.equal(first?.priority, "command");
	});

	it("reports correct length", () => {
		const q = new MessageQueue();
		assert.equal(q.length, 0);
		q.enqueue("a");
		q.enqueue("b");
		assert.equal(q.length, 2);
	});

	it("clears all messages", () => {
		const q = new MessageQueue();
		q.enqueue("a");
		q.enqueue("b");
		q.clear();
		assert.equal(q.length, 0);
	});

	it("drainBatched combines same-priority messages", () => {
		const q = new MessageQueue();
		q.enqueue("n1", "notification");
		q.enqueue("n2", "notification");
		q.enqueue("c1", "command");

		const batches = q.drainBatched(60000); // large window
		// Should be: command batch first, then notification batch
		assert.equal(batches.length, 2);
		assert.ok(batches[0].includes("c1"));
		assert.ok(batches[1].includes("n1"));
		assert.ok(batches[1].includes("n2"));
	});

	it("drainBatched empties the queue", () => {
		const q = new MessageQueue();
		q.enqueue("a");
		q.drainBatched();
		assert.equal(q.length, 0);
	});
});

// ─── Formatter tests ────────────────────────────────────────────────

describe("Formatter — escapeMdV2", () => {
	it("escapes all special characters", () => {
		const input = "hello_world *bold* [link](url) ~strike~ `code` >quote #tag +plus -minus =eq |pipe {brace} .dot !excl";
		const escaped = escapeMdV2(input);
		assert.ok(escaped.includes("\\_"));
		assert.ok(escaped.includes("\\*"));
		assert.ok(escaped.includes("\\["));
		assert.ok(escaped.includes("\\]"));
		assert.ok(escaped.includes("\\("));
		assert.ok(escaped.includes("\\)"));
		assert.ok(escaped.includes("\\~"));
		assert.ok(escaped.includes("\\`"));
		assert.ok(escaped.includes("\\>"));
		assert.ok(escaped.includes("\\#"));
	});

	it("preserves normal text", () => {
		assert.equal(escapeMdV2("hello world 123"), "hello world 123");
	});
});

describe("Formatter — escapeHtmlTg", () => {
	it("escapes HTML entities", () => {
		assert.equal(escapeHtmlTg("<b>bold</b> & 'quotes'"), "&lt;b&gt;bold&lt;/b&gt; &amp; 'quotes'");
	});
});

describe("Formatter — codeBlock", () => {
	it("wraps in pre tags", () => {
		const result = codeBlock("const x = 1;");
		assert.ok(result.startsWith("<pre>"));
		assert.ok(result.includes("const x = 1;"));
	});

	it("adds language class when specified", () => {
		const result = codeBlock("const x = 1;", "typescript");
		assert.ok(result.includes('class="language-typescript"'));
	});
});

describe("Formatter — inlineCode", () => {
	it("wraps in code tags", () => {
		assert.equal(inlineCode("npm test"), "<code>npm test</code>");
	});

	it("escapes HTML in code", () => {
		assert.ok(inlineCode("<script>").includes("&lt;"));
	});
});

describe("Formatter — progressBar", () => {
	it("renders 0%", () => {
		const bar = progressBar(0);
		assert.ok(bar.includes("░░░░░░░░░░"));
		assert.ok(bar.includes("0%"));
	});

	it("renders 100%", () => {
		const bar = progressBar(100);
		assert.ok(bar.includes("██████████"));
		assert.ok(bar.includes("100%"));
	});

	it("renders 50%", () => {
		const bar = progressBar(50);
		assert.ok(bar.includes("█████"));
		assert.ok(bar.includes("░░░░░"));
	});

	it("clamps to 0-100", () => {
		assert.ok(progressBar(-10).includes("0%"));
		assert.ok(progressBar(200).includes("100%"));
	});

	it("supports custom width", () => {
		const bar = progressBar(50, 20);
		const filled = (bar.match(/█/g) || []).length;
		assert.equal(filled, 10);
	});
});

describe("Formatter — statusCard", () => {
	it("formats title and fields", () => {
		const card = statusCard("Server Status", { CPU: "42%", RAM: "8GB" });
		assert.ok(card.includes("Server Status"));
		assert.ok(card.includes("CPU"));
		assert.ok(card.includes("42%"));
	});
});

describe("Formatter — spoiler", () => {
	it("wraps in tg-spoiler tags", () => {
		const result = spoiler("hidden text");
		assert.ok(result.includes("<tg-spoiler>"));
		assert.ok(result.includes("hidden text"));
	});
});

describe("Formatter — formatDiff", () => {
	it("highlights additions and removals", () => {
		const diff = "+added line\n-removed line\n context line";
		const result = formatDiff(diff);
		assert.ok(result.includes("<b>+"));
		assert.ok(result.includes("<s>-"));
	});

	it("truncates long diffs", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n");
		const result = formatDiff(lines, 10);
		assert.ok(result.includes("more lines"));
	});

	it("does not highlight +++ and --- headers", () => {
		const diff = "--- a/file.ts\n+++ b/file.ts\n+added";
		const result = formatDiff(diff);
		// --- header should not be wrapped in <s>
		assert.ok(!result.startsWith("<s>"));
	});
});

describe("Formatter — safeTruncate", () => {
	it("preserves short text", () => {
		assert.equal(safeTruncate("hi", 10), "hi");
	});

	it("truncates with ellipsis", () => {
		const result = safeTruncate("hello world", 6);
		assert.equal(result.length, 6);
		assert.ok(result.endsWith("…"));
	});
});
