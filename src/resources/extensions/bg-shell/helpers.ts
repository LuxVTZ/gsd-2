/**
 * Pure helper functions extracted from bg-shell for testability.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ProcessType = "server" | "build" | "test" | "watcher" | "generic" | "shell";

export type ProcessStatus =
	| "starting"
	| "ready"
	| "error"
	| "exited"
	| "crashed";

export interface OutputDigest {
	status: ProcessStatus;
	uptime: string;
	errors: string[];
	warnings: string[];
	urls: string[];
	ports: number[];
	lastActivity: string;
	outputLines: number;
	changeSummary: string;
}

// ── Pattern Databases ──────────────────────────────────────────────────────

/** Patterns that indicate a process is ready/listening */
export const READINESS_PATTERNS: RegExp[] = [
	/listening\s+on\s+(?:port\s+)?(\d+)/i,
	/server\s+(?:is\s+)?(?:running|started|listening)\s+(?:at|on)\s+/i,
	/ready\s+(?:in|on|at)\s+/i,
	/started\s+(?:server\s+)?on\s+/i,
	/Local:\s*https?:\/\//i,
	/➜\s+Local:\s*/i,
	/compiled\s+(?:successfully|client\s+and\s+server)/i,
	/running\s+on\s+https?:\/\//i,
	/Uvicorn\s+running/i,
	/Development\s+server\s+is\s+running/i,
	/press\s+ctrl[\-+]c\s+to\s+(?:quit|stop)/i,
	/watching\s+for\s+(?:file\s+)?changes/i,
	/build\s+(?:completed|succeeded|finished)/i,
];

/** Patterns that indicate errors */
export const ERROR_PATTERNS: RegExp[] = [
	/\berror\b[\s:[\](]/i,
	/\bERROR\b/,
	/\bfailed\b/i,
	/\bFAILED\b/,
	/\bfatal\b/i,
	/\bFATAL\b/,
	/\bexception\b/i,
	/\bpanic\b/i,
	/\bsegmentation\s+fault\b/i,
	/\bsyntax\s*error\b/i,
	/\btype\s*error\b/i,
	/\breference\s*error\b/i,
	/Cannot\s+find\s+module/i,
	/Module\s+not\s+found/i,
	/ENOENT/,
	/EACCES/,
	/EADDRINUSE/,
	/TS\d{4,5}:/,
	/E\d{4,5}:/,
	/\[ERROR\]/,
	/✖|✗|❌/,
];

/** Patterns that indicate warnings */
export const WARNING_PATTERNS: RegExp[] = [
	/\bwarning\b[\s:[\](]/i,
	/\bWARN(?:ING)?\b/,
	/\bdeprecated\b/i,
	/\bDEPRECATED\b/,
	/⚠️?/,
	/\[WARN\]/,
];

/** Patterns to extract URLs */
export const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;

/** Patterns to extract port numbers from "listening" messages */
export const PORT_PATTERN = /(?:port|listening\s+on|:)\s*(\d{2,5})\b/gi;

/** Patterns indicating test results */
export const TEST_RESULT_PATTERNS: RegExp[] = [
	/(\d+)\s+(?:tests?\s+)?passed/i,
	/(\d+)\s+(?:tests?\s+)?failed/i,
	/Tests?:\s+(\d+)\s+passed/i,
	/(\d+)\s+passing/i,
	/(\d+)\s+failing/i,
	/PASS|FAIL/,
];

/** Patterns indicating build completion */
export const BUILD_COMPLETE_PATTERNS: RegExp[] = [
	/build\s+(?:completed|succeeded|finished|done)/i,
	/compiled\s+(?:successfully|with\s+\d+\s+(?:error|warning))/i,
	/✓\s+Built/i,
	/webpack\s+\d+\.\d+/i,
	/bundle\s+(?:is\s+)?ready/i,
];

// ── Pure Helper Functions ──────────────────────────────────────────────────

export function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function detectProcessType(command: string): ProcessType {
	const cmd = command.toLowerCase();

	// Server patterns
	if (
		/\b(serve|server|dev|start)\b/.test(cmd) &&
		/\b(npm|yarn|pnpm|bun|node|next|vite|nuxt|astro|remix|gatsby|uvicorn|flask|django|rails|cargo)\b/.test(cmd)
	) return "server";
	if (/\b(uvicorn|gunicorn|flask\s+run|manage\.py\s+runserver|rails\s+s)\b/.test(cmd)) return "server";
	if (/\b(http-server|live-server|serve)\b/.test(cmd)) return "server";

	// Build patterns
	if (/\b(build|compile|make|tsc|webpack|rollup|esbuild|swc)\b/.test(cmd)) {
		if (/\b(watch|--watch|-w)\b/.test(cmd)) return "watcher";
		return "build";
	}

	// Test patterns
	if (/\b(test|jest|vitest|mocha|pytest|cargo\s+test|go\s+test|rspec)\b/.test(cmd)) return "test";

	// Watcher patterns
	if (/\b(watch|nodemon|chokidar|fswatch|inotifywait)\b/.test(cmd)) return "watcher";

	return "generic";
}

export function generateChangeSummary(
	newLines: number,
	newErrors: number,
	newWarnings: number,
): string {
	if (newLines === 0) return "no new output";
	const parts: string[] = [];
	parts.push(`${newLines} new lines`);
	if (newErrors > 0) parts.push(`${newErrors} new errors`);
	if (newWarnings > 0) parts.push(`${newWarnings} new warnings`);
	return parts.join(", ");
}

export function matchesErrorPattern(line: string): boolean {
	return ERROR_PATTERNS.some(p => p.test(line));
}

export function matchesWarningPattern(line: string): boolean {
	return WARNING_PATTERNS.some(p => p.test(line));
}

export function matchesReadinessPattern(line: string): boolean {
	return READINESS_PATTERNS.some(p => p.test(line));
}

export function extractUrls(line: string): string[] {
	const re = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
	return line.match(re) ?? [];
}

export function extractPorts(line: string): number[] {
	const ports: number[] = [];
	const re = new RegExp(PORT_PATTERN.source, PORT_PATTERN.flags);
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		const port = parseInt(m[1], 10);
		if (port > 0 && port <= 65535) ports.push(port);
	}
	return ports;
}

export interface FormatDigestInput {
	id: string;
	label: string;
	processType: ProcessType;
}

export function formatDigestText(proc: FormatDigestInput, digest: OutputDigest): string {
	let text = `Process ${proc.id} (${proc.label}):\n`;
	text += `  status: ${digest.status}\n`;
	text += `  type: ${proc.processType}\n`;
	text += `  uptime: ${digest.uptime}\n`;

	if (digest.ports.length > 0) text += `  ports: ${digest.ports.join(", ")}\n`;
	if (digest.urls.length > 0) text += `  urls: ${digest.urls.join(", ")}\n`;

	text += `  output: ${digest.outputLines} lines\n`;
	text += `  changes: ${digest.changeSummary}`;

	if (digest.errors.length > 0) {
		text += `\n  errors (${digest.errors.length}):`;
		for (const err of digest.errors) {
			text += `\n    - ${err}`;
		}
	}
	if (digest.warnings.length > 0) {
		text += `\n  warnings (${digest.warnings.length}):`;
		for (const w of digest.warnings) {
			text += `\n    - ${w}`;
		}
	}

	return text;
}
