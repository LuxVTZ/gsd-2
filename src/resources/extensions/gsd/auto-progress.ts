/**
 * Progress widget & dashboard helpers — extracted from auto.ts.
 *
 * Contains the TUI progress widget, formatting helpers, and unit-type
 * label mappers used exclusively for the auto-mode progress display.
 */

import type {
  ExtensionContext,
  ExtensionCommandContext,
} from "@gsd/pi-coding-agent";

import type { GSDState } from "./types.js";
import { getCurrentBranch } from "./worktree.js";
import { getLedger, getProjectTotals } from "./metrics.js";
import { getRoadmapSlicesSync } from "./auto-roadmap.js";
import { truncateToWidth, visibleWidth } from "@gsd/pi-tui";
import { makeUI, GLYPH, INDENT } from "../shared/ui.js";

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Format token counts for compact display */
export function formatWidgetTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function unitVerb(unitType: string): string {
  switch (unitType) {
    case "research-milestone":
    case "research-slice": return "researching";
    case "plan-milestone":
    case "plan-slice": return "planning";
    case "execute-task": return "executing";
    case "complete-slice": return "completing";
    case "replan-slice": return "replanning";
    case "reassess-roadmap": return "reassessing";
    case "run-uat": return "running UAT";
    case "fix-merge": return "resolving conflicts";
    default: return unitType;
  }
}

export function unitPhaseLabel(unitType: string): string {
  switch (unitType) {
    case "research-milestone": return "RESEARCH";
    case "research-slice": return "RESEARCH";
    case "plan-milestone": return "PLAN";
    case "plan-slice": return "PLAN";
    case "execute-task": return "EXECUTE";
    case "complete-slice": return "COMPLETE";
    case "replan-slice": return "REPLAN";
    case "reassess-roadmap": return "REASSESS";
    case "run-uat": return "UAT";
    case "fix-merge": return "MERGE-FIX";
    default: return unitType.toUpperCase();
  }
}

export function peekNext(unitType: string, state: GSDState): string {
  const sid = state.activeSlice?.id ?? "";
  switch (unitType) {
    case "research-milestone": return "plan milestone roadmap";
    case "plan-milestone": return "plan or execute first slice";
    case "research-slice": return `plan ${sid}`;
    case "plan-slice": return "execute first task";
    case "execute-task": return `continue ${sid}`;
    case "complete-slice": return "reassess roadmap";
    case "replan-slice": return `re-execute ${sid}`;
    case "reassess-roadmap": return "advance to next slice";
    case "run-uat": return "reassess roadmap";
    case "fix-merge": return "continue merge";
    default: return "";
  }
}

/** Right-align helper: build a line with left content and right content. */
export function rightAlign(left: string, right: string, width: number): string {
  const leftVis = visibleWidth(left);
  const rightVis = visibleWidth(right);
  const gap = Math.max(1, width - leftVis - rightVis);
  return truncateToWidth(left + " ".repeat(gap) + right, width);
}

/** Format elapsed time since auto-mode started */
export function formatAutoElapsed(autoStartTime: number): string {
  if (!autoStartTime) return "";
  const ms = Date.now() - autoStartTime;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs > 0 ? ` ${rs}s` : ""}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

// ─── Progress Widget ──────────────────────────────────────────────────────────

/** Module-level state needed by the progress widget render closure. */
export interface ProgressWidgetState {
  basePath: string;
  stepMode: boolean;
  autoStartTime: number;
  cmdCtx: ExtensionCommandContext | null;
}

export function updateProgressWidget(
  ctx: ExtensionContext,
  unitType: string,
  unitId: string,
  state: GSDState,
  widgetState: ProgressWidgetState,
): void {
  if (!ctx.hasUI) return;

  const verb = unitVerb(unitType);
  const phaseLabel = unitPhaseLabel(unitType);
  const mid = state.activeMilestone;
  const slice = state.activeSlice;
  const task = state.activeTask;
  const next = peekNext(unitType, state);

  const { basePath, stepMode, autoStartTime, cmdCtx } = widgetState;

  // Cache git branch at widget creation time (not per render)
  let cachedBranch: string | null = null;
  try { cachedBranch = getCurrentBranch(basePath); } catch { /* not in git repo */ }

  // Cache pwd with ~ substitution
  let widgetPwd = process.cwd();
  const widgetHome = process.env.HOME || process.env.USERPROFILE;
  if (widgetHome && widgetPwd.startsWith(widgetHome)) {
    widgetPwd = `~${widgetPwd.slice(widgetHome.length)}`;
  }
  if (cachedBranch) widgetPwd = `${widgetPwd} (${cachedBranch})`;

  ctx.ui.setWidget("gsd-progress", (tui, theme) => {
    let pulseBright = true;
    let cachedLines: string[] | undefined;
    let cachedWidth: number | undefined;

    const pulseTimer = setInterval(() => {
      pulseBright = !pulseBright;
      cachedLines = undefined;
      tui.requestRender();
    }, 800);

    return {
      render(width: number): string[] {
        if (cachedLines && cachedWidth === width) return cachedLines;

        const ui = makeUI(theme, width);
        const lines: string[] = [];
        const pad = INDENT.base;

        // ── Line 1: Top bar ───────────────────────────────────────────────
        lines.push(...ui.bar());

        const dot = pulseBright
          ? theme.fg("accent", GLYPH.statusActive)
          : theme.fg("dim", GLYPH.statusPending);
        const elapsed = formatAutoElapsed(autoStartTime);
        const modeTag = stepMode ? "NEXT" : "AUTO";
        const headerLeft = `${pad}${dot} ${theme.fg("accent", theme.bold("GSD"))}  ${theme.fg("success", modeTag)}`;
        const headerRight = elapsed ? theme.fg("dim", elapsed) : "";
        lines.push(rightAlign(headerLeft, headerRight, width));

        lines.push("");

        if (mid) {
          lines.push(truncateToWidth(`${pad}${theme.fg("dim", mid.title)}`, width));
        }

        if (slice && unitType !== "research-milestone" && unitType !== "plan-milestone") {
          lines.push(truncateToWidth(
            `${pad}${theme.fg("text", theme.bold(`${slice.id}: ${slice.title}`))}`,
            width,
          ));
        }

        lines.push("");

        const target = task ? `${task.id}: ${task.title}` : unitId;
        const actionLeft = `${pad}${theme.fg("accent", "▸")} ${theme.fg("accent", verb)}  ${theme.fg("text", target)}`;
        const phaseBadge = theme.fg("dim", phaseLabel);
        lines.push(rightAlign(actionLeft, phaseBadge, width));
        lines.push("");

        if (mid) {
          const roadmapSlices = getRoadmapSlicesSync();
          if (roadmapSlices) {
            const { done, total, activeSliceTasks } = roadmapSlices;
            const barWidth = Math.max(8, Math.min(24, Math.floor(width * 0.3)));
            const pct = total > 0 ? done / total : 0;
            const filled = Math.round(pct * barWidth);
            const bar = theme.fg("success", "█".repeat(filled))
              + theme.fg("dim", "░".repeat(barWidth - filled));

            let meta = theme.fg("dim", `${done}/${total} slices`);

            if (activeSliceTasks && activeSliceTasks.total > 0) {
              meta += theme.fg("dim", `  ·  task ${activeSliceTasks.done + 1}/${activeSliceTasks.total}`);
            }

            lines.push(truncateToWidth(`${pad}${bar}  ${meta}`, width));
          }
        }

        lines.push("");

        if (next) {
          lines.push(truncateToWidth(
            `${pad}${theme.fg("dim", "→")} ${theme.fg("dim", `then ${next}`)}`,
            width,
          ));
        }

        // ── Footer info (pwd, tokens, cost, context, model) ──────────────
        lines.push("");
        lines.push(truncateToWidth(theme.fg("dim", `${pad}${widgetPwd}`), width, theme.fg("dim", "…")));

        // Token stats from current unit session + cumulative cost from metrics
        {
          let totalInput = 0, totalOutput = 0;
          let totalCacheRead = 0, totalCacheWrite = 0;
          if (cmdCtx) {
            for (const entry of cmdCtx.sessionManager.getEntries()) {
              if (entry.type === "message" && (entry as any).message?.role === "assistant") {
                const u = (entry as any).message.usage;
                if (u) {
                  totalInput += u.input || 0;
                  totalOutput += u.output || 0;
                  totalCacheRead += u.cacheRead || 0;
                  totalCacheWrite += u.cacheWrite || 0;
                }
              }
            }
          }
          const mLedger = getLedger();
          const autoTotals = mLedger ? getProjectTotals(mLedger.units) : null;
          const cumulativeCost = autoTotals?.cost ?? 0;

          const cxUsage = cmdCtx?.getContextUsage?.();
          const cxWindow = cxUsage?.contextWindow ?? cmdCtx?.model?.contextWindow ?? 0;
          const cxPctVal = cxUsage?.percent ?? 0;
          const cxPct = cxUsage?.percent !== null ? cxPctVal.toFixed(1) : "?";

          const sp: string[] = [];
          if (totalInput) sp.push(`↑${formatWidgetTokens(totalInput)}`);
          if (totalOutput) sp.push(`↓${formatWidgetTokens(totalOutput)}`);
          if (totalCacheRead) sp.push(`R${formatWidgetTokens(totalCacheRead)}`);
          if (totalCacheWrite) sp.push(`W${formatWidgetTokens(totalCacheWrite)}`);
          if (cumulativeCost) sp.push(`$${cumulativeCost.toFixed(3)}`);

          const cxDisplay = cxPct === "?"
            ? `?/${formatWidgetTokens(cxWindow)}`
            : `${cxPct}%/${formatWidgetTokens(cxWindow)}`;
          if (cxPctVal > 90) {
            sp.push(theme.fg("error", cxDisplay));
          } else if (cxPctVal > 70) {
            sp.push(theme.fg("warning", cxDisplay));
          } else {
            sp.push(cxDisplay);
          }

          const sLeft = sp.map(p => p.includes("\x1b[") ? p : theme.fg("dim", p))
            .join(theme.fg("dim", " "));

          const modelId = cmdCtx?.model?.id ?? "";
          const sRight = modelId ? theme.fg("dim", modelId) : "";
          lines.push(rightAlign(`${pad}${sLeft}`, sRight, width));
        }

        const hintParts: string[] = [];
        hintParts.push("esc pause");
        hintParts.push(process.platform === "darwin" ? "⌃⌥G dashboard" : "Ctrl+Alt+G dashboard");
        lines.push(...ui.hints(hintParts));

        lines.push(...ui.bar());

        cachedLines = lines;
        cachedWidth = width;
        return lines;
      },
      invalidate() {
        cachedLines = undefined;
        cachedWidth = undefined;
      },
      dispose() {
        clearInterval(pulseTimer);
      },
    };
  });
}
