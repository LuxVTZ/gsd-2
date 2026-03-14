/**
 * Structured logger with configurable levels.
 *
 * Usage:
 *   import { createLogger } from "./logger.ts";
 *   const log = createLogger("gh-api");
 *   log.info("request", { url });
 *   log.warn("retry", { attempt: 2, status: 429 });
 *   log.error("failed", { error: err.message });
 *   log.debug("response", { body });
 *
 * Configuration:
 *   GSD_LOG_LEVEL=debug|info|warn|error (default: info)
 *   GSD_LOG_JSON=1 — machine-parseable JSON output
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

function getConfiguredLevel(): LogLevel {
	const env = process.env.GSD_LOG_LEVEL?.toLowerCase();
	if (env && env in LEVELS) return env as LogLevel;
	return "info";
}

function isJsonMode(): boolean {
	return process.env.GSD_LOG_JSON === "1";
}

function formatTimestamp(): string {
	return new Date().toISOString();
}

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
	const minLevel = getConfiguredLevel();
	const json = isJsonMode();

	function shouldLog(level: LogLevel): boolean {
		return LEVELS[level] >= LEVELS[minLevel];
	}

	function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
		if (!shouldLog(level)) return;

		if (json) {
			const entry = {
				ts: formatTimestamp(),
				level,
				component,
				msg: message,
				...data,
			};
			process.stderr.write(JSON.stringify(entry) + "\n");
		} else {
			const prefix = `[${level.toUpperCase()}] [${formatTimestamp()}] [${component}]`;
			const suffix = data && Object.keys(data).length > 0
				? ` ${JSON.stringify(data)}`
				: "";
			process.stderr.write(`${prefix} ${message}${suffix}\n`);
		}
	}

	return {
		debug: (msg, data) => emit("debug", msg, data),
		info: (msg, data) => emit("info", msg, data),
		warn: (msg, data) => emit("warn", msg, data),
		error: (msg, data) => emit("error", msg, data),
	};
}
