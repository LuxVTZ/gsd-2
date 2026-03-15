/**
 * Telegram Rate Limiter — token bucket + message batching for Telegram API limits.
 *
 * Telegram allows ~30 messages/second per chat. This module:
 * - Token bucket rate limiter (configurable rate)
 * - Priority queue: commands > approvals > progress > notifications
 * - Batch rapid messages into single sends
 */

export type MessagePriority = "command" | "approval" | "progress" | "notification";

const PRIORITY_ORDER: Record<MessagePriority, number> = {
	command: 0,
	approval: 1,
	progress: 2,
	notification: 3,
};

interface QueuedMessage {
	text: string;
	priority: MessagePriority;
	timestamp: number;
}

export interface RateLimiterOptions {
	/** Max tokens (messages) per second. Default: 20 */
	tokensPerSecond?: number;
	/** Max burst size. Default: 5 */
	maxBurst?: number;
	/** Batch window in ms. Default: 1000 */
	batchWindowMs?: number;
}

/**
 * Token bucket rate limiter.
 * Pure, testable implementation without side effects.
 */
export class TokenBucket {
	private tokens: number;
	private readonly maxTokens: number;
	private readonly refillRate: number;
	private lastRefill: number;

	constructor(maxTokens: number, refillRate: number) {
		this.maxTokens = maxTokens;
		this.tokens = maxTokens;
		this.refillRate = refillRate;
		this.lastRefill = Date.now();
	}

	/** Try to consume one token. Returns true if allowed. */
	tryConsume(): boolean {
		this.refill();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			return true;
		}
		return false;
	}

	/** Time in ms until next token is available. */
	waitTime(): number {
		this.refill();
		if (this.tokens >= 1) return 0;
		return Math.ceil((1 - this.tokens) / this.refillRate * 1000);
	}

	private refill(): void {
		const now = Date.now();
		const elapsed = (now - this.lastRefill) / 1000;
		this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
		this.lastRefill = now;
	}

	/** Current available tokens (for testing). */
	get available(): number {
		this.refill();
		return Math.floor(this.tokens);
	}
}

/**
 * Message queue with priority ordering and batching.
 * Pure data structure — no I/O.
 */
export class MessageQueue {
	private queue: QueuedMessage[] = [];

	enqueue(text: string, priority: MessagePriority = "notification"): void {
		this.queue.push({ text, priority, timestamp: Date.now() });
		// Sort by priority (lower = higher priority), then by timestamp
		this.queue.sort((a, b) => {
			const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
			if (pd !== 0) return pd;
			return a.timestamp - b.timestamp;
		});
	}

	dequeue(): QueuedMessage | undefined {
		return this.queue.shift();
	}

	/** Drain all messages, batching same-priority messages within windowMs. */
	drainBatched(windowMs = 1000): string[] {
		if (this.queue.length === 0) return [];

		const batches: string[] = [];
		let currentBatch: string[] = [];
		let currentPriority: MessagePriority | null = null;
		let batchStart = 0;

		for (const msg of this.queue) {
			if (currentPriority !== msg.priority || msg.timestamp - batchStart > windowMs) {
				if (currentBatch.length > 0) {
					batches.push(currentBatch.join("\n"));
				}
				currentBatch = [msg.text];
				currentPriority = msg.priority;
				batchStart = msg.timestamp;
			} else {
				currentBatch.push(msg.text);
			}
		}
		if (currentBatch.length > 0) {
			batches.push(currentBatch.join("\n"));
		}

		this.queue = [];
		return batches;
	}

	get length(): number {
		return this.queue.length;
	}

	clear(): void {
		this.queue = [];
	}
}
