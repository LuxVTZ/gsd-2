/**
 * Shared type definitions for common patterns across extensions.
 *
 * These types fill SDK gaps where upstream types don't fully cover
 * the runtime behavior of the framework.
 */

/**
 * MCP-style tool result that may carry an `isError` flag.
 * Used by mcporter bridge, context7, google-search, and bg-shell.
 */
export interface McpToolResult {
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
	[key: string]: unknown;
}

/**
 * Check if a value is an MCP-style error result.
 */
export function isMcpError(result: unknown): result is McpToolResult & { isError: true } {
	return typeof result === "object" && result !== null && (result as McpToolResult).isError === true;
}

/**
 * Session entry with optional message field (used in token counting/streaming).
 */
export interface SessionEntryWithMessage {
	type: string;
	message?: {
		role?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	};
}
