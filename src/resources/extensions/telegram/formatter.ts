/**
 * Telegram Rich Formatter — MarkdownV2 and HTML formatting utilities.
 *
 * Telegram's MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * We use HTML parse mode primarily, but this module provides both.
 */

/** Escape text for Telegram MarkdownV2 parse mode. */
export function escapeMdV2(text: string): string {
	return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/** Escape text for Telegram HTML parse mode. */
export function escapeHtmlTg(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format code block for HTML mode. */
export function codeBlock(code: string, language?: string): string {
	if (language) {
		return `<pre><code class="language-${escapeHtmlTg(language)}">${escapeHtmlTg(code)}</code></pre>`;
	}
	return `<pre>${escapeHtmlTg(code)}</pre>`;
}

/** Format inline code for HTML mode. */
export function inlineCode(text: string): string {
	return `<code>${escapeHtmlTg(text)}</code>`;
}

/** Format a progress bar. */
export function progressBar(percent: number, width = 10): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * width);
	const empty = width - filled;
	return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped}%`;
}

/** Format a status card with emoji header. */
export function statusCard(title: string, fields: Record<string, string>): string {
	const lines = [`<b>${escapeHtmlTg(title)}</b>`];
	for (const [key, value] of Object.entries(fields)) {
		lines.push(`• <b>${escapeHtmlTg(key)}:</b> ${escapeHtmlTg(value)}`);
	}
	return lines.join("\n");
}

/** Wrap text in Telegram spoiler (hidden by default, tap to reveal). */
export function spoiler(text: string): string {
	return `<tg-spoiler>${escapeHtmlTg(text)}</tg-spoiler>`;
}

/** Format a file diff with additions/removals highlighted. */
export function formatDiff(diff: string, maxLines = 30): string {
	const lines = diff.split("\n").slice(0, maxLines);
	const formatted = lines.map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			return `<b>+ ${escapeHtmlTg(line.slice(1))}</b>`;
		}
		if (line.startsWith("-") && !line.startsWith("---")) {
			return `<s>- ${escapeHtmlTg(line.slice(1))}</s>`;
		}
		return escapeHtmlTg(line);
	});

	const result = formatted.join("\n");
	if (diff.split("\n").length > maxLines) {
		return result + `\n\n<i>... ${diff.split("\n").length - maxLines} more lines</i>`;
	}
	return result;
}

/** Truncate with a Telegram-safe ellipsis. */
export function safeTruncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1) + "…";
}
