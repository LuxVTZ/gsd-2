/**
 * Telegram Config — environment variable resolution and approval level management.
 */

export const APPROVE_LEVELS = ["all", "destructive", "none"] as const;
export type ApproveLevel = (typeof APPROVE_LEVELS)[number];

let currentApproveLevel: ApproveLevel | null = null;

/** Get the current approval sensitivity level. */
export function getApproveLevel(): ApproveLevel {
	if (currentApproveLevel) return currentApproveLevel;
	const env = process.env.GSD_TELEGRAM_APPROVE?.toLowerCase();
	if (env && APPROVE_LEVELS.includes(env as ApproveLevel)) {
		return env as ApproveLevel;
	}
	return "destructive";
}

/** Set the approval level at runtime. */
export function setApproveLevel(level: ApproveLevel): void {
	currentApproveLevel = level;
}

/** Reset to env-based default (for testing). */
export function resetApproveLevel(): void {
	currentApproveLevel = null;
}

/** Tools that are considered destructive and require approval in "destructive" mode. */
const DESTRUCTIVE_TOOLS = new Set([
	"bash",
	"write_file",
	"edit_file",
	"delete_file",
	"bg_shell",
]);

/** Check if a tool call should require approval given the current level. */
export function requiresApproval(toolName: string): boolean {
	const level = getApproveLevel();
	if (level === "none") return false;
	if (level === "all") return true;
	// "destructive" — only approve destructive tools
	return DESTRUCTIVE_TOOLS.has(toolName);
}

/** Get Telegram config from environment. Returns null if not configured. */
export function getTelegramConfig(): { token: string; ownerId: string } | null {
	const token = process.env.GSD_TELEGRAM_TOKEN;
	const ownerId = process.env.GSD_TELEGRAM_OWNER_ID;
	if (!token || !ownerId) return null;
	return { token, ownerId };
}
