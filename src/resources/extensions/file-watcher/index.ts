/**
 * File Watcher Extension
 *
 * Monitors project files for external changes and notifies the agent.
 * Useful for detecting CI results, editor saves, and test output changes.
 *
 * Configuration via .gsd/preferences.md:
 *   file-watcher:
 *     enabled: true
 *     patterns: ["src/**", ".gsd/**"]
 *     ignore: ["node_modules", "dist", ".git"]
 *     debounce: 300
 *
 * Commands:
 *   /watch — toggle file watcher on/off
 */

import { watch, type FSWatcher } from "node:fs";
import { resolve, relative, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { createLogger } from "../shared/logger.js";

const log = createLogger("file-watcher");

// ─── Configuration ────────────────────────────────────────────────────────────

export interface FileWatcherConfig {
	enabled: boolean;
	patterns: string[];
	ignore: string[];
	debounceMs: number;
}

const DEFAULT_CONFIG: FileWatcherConfig = {
	enabled: false,
	patterns: ["src", ".gsd"],
	ignore: ["node_modules", "dist", ".git", "pkg", "native/target"],
	debounceMs: 300,
};

export function parseConfig(prefs: Record<string, unknown> | undefined): FileWatcherConfig {
	if (!prefs) return { ...DEFAULT_CONFIG };
	const fw = (prefs["file-watcher"] ?? prefs["fileWatcher"] ?? {}) as Record<string, unknown>;
	return {
		enabled: typeof fw.enabled === "boolean" ? fw.enabled : DEFAULT_CONFIG.enabled,
		patterns: Array.isArray(fw.patterns) ? fw.patterns.map(String) : DEFAULT_CONFIG.patterns,
		ignore: Array.isArray(fw.ignore) ? fw.ignore.map(String) : DEFAULT_CONFIG.ignore,
		debounceMs: typeof fw.debounce === "number" ? fw.debounce : DEFAULT_CONFIG.debounceMs,
	};
}

// ─── Debounce helper ──────────────────────────────────────────────────────────

export function createDebouncer(delayMs: number): {
	debounce: (key: string, fn: () => void) => void;
	clear: () => void;
} {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	return {
		debounce(key: string, fn: () => void) {
			const existing = timers.get(key);
			if (existing) clearTimeout(existing);
			timers.set(key, setTimeout(() => {
				timers.delete(key);
				fn();
			}, delayMs));
		},
		clear() {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
		},
	};
}

// ─── Path filtering ───────────────────────────────────────────────────────────

export function shouldIgnore(filePath: string, ignoreList: string[]): boolean {
	const parts = filePath.split("/");
	return ignoreList.some((ig) => parts.includes(ig) || filePath.startsWith(ig));
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function fileWatcher(pi: ExtensionAPI) {
	let watchers: FSWatcher[] = [];
	let config = { ...DEFAULT_CONFIG };
	let debouncer = createDebouncer(config.debounceMs);
	let isActive = false;

	function stopWatching() {
		for (const w of watchers) {
			try { w.close(); } catch { /* already closed */ }
		}
		watchers = [];
		debouncer.clear();
		isActive = false;
		log.info("stopped");
	}

	function startWatching(cwd: string) {
		stopWatching();
		if (!config.enabled) return;

		for (const pattern of config.patterns) {
			const watchPath = resolve(cwd, pattern);
			if (!existsSync(watchPath)) {
				log.debug("skip missing path", { path: watchPath });
				continue;
			}

			try {
				const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
					if (!filename) return;
					const rel = relative(cwd, resolve(watchPath, filename));
					if (shouldIgnore(rel, config.ignore)) return;

					debouncer.debounce(rel, () => {
						log.debug("file changed", { event: eventType, file: rel });
						pi.sendMessage(
							{
								customType: "file-changed",
								content: `File changed externally: ${rel} (${eventType})`,
								display: false,
							},
							{ triggerTurn: false },
						);
					});
				});

				watchers.push(watcher);
				log.info("watching", { path: watchPath });
			} catch (err) {
				log.warn("watch failed", { path: watchPath, error: String(err) });
			}
		}

		isActive = true;
	}

	// ─── /watch command ───────────────────────────────────────────────────

	pi.registerCommand("watch", {
		description: "Toggle file watcher on/off, or configure watch patterns",
		async handler(args: string, ctx: ExtensionCommandContext) {
			const trimmed = args.trim().toLowerCase();

			if (trimmed === "off" || trimmed === "stop") {
				config.enabled = false;
				stopWatching();
				ctx.ui.notify("File watcher stopped", "info");
				return;
			}

			if (trimmed === "on" || trimmed === "start" || trimmed === "") {
				config.enabled = true;
				startWatching(process.cwd());
				ctx.ui.notify(`File watcher started (${config.patterns.join(", ")})`, "info");
				return;
			}

			if (trimmed === "status") {
				const status = isActive ? "active" : "inactive";
				const dirs = config.patterns.join(", ");
				ctx.ui.notify(`File watcher: ${status}\nPatterns: ${dirs}\nIgnore: ${config.ignore.join(", ")}\nDebounce: ${config.debounceMs}ms`, "info");
				return;
			}

			// Add a watch pattern
			if (trimmed.startsWith("add ")) {
				const pattern = trimmed.slice(4).trim();
				if (pattern && !config.patterns.includes(pattern)) {
					config.patterns.push(pattern);
					if (isActive) startWatching(process.cwd()); // restart with new pattern
					ctx.ui.notify(`Added watch pattern: ${pattern}`, "info");
				}
				return;
			}

			ctx.ui.notify("Usage: /watch [on|off|status|add <pattern>]", "info");
		},
	});

	// ─── Lifecycle hooks ──────────────────────────────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		// Read preferences if available
		try {
			const prefs = (pi as Record<string, unknown>).preferences as Record<string, unknown> | undefined;
			config = parseConfig(prefs);
			debouncer = createDebouncer(config.debounceMs);
			if (config.enabled) {
				startWatching(process.cwd());
			}
		} catch {
			// Preferences not available — use defaults
		}
	});

	// Clean up on session end
	pi.on("session_end" as Parameters<typeof pi.on>[0], async () => {
		stopWatching();
	});
}
