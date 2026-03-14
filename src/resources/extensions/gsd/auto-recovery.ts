/**
 * Recovery & artifact verification helpers — extracted from auto.ts.
 *
 * Contains the idle/hard-timeout recovery logic and the pure helper
 * functions for resolving, verifying, and writing expected artifacts.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@gsd/pi-coding-agent";

import {
  resolveMilestonePath, resolveSlicePath, resolveSliceFile,
  resolveMilestoneFile,
  resolveTasksDir, relMilestoneFile, relSliceFile, relSlicePath,
  relTaskFile, buildMilestoneFileName, buildSliceFileName, buildTaskFileName,
} from "./paths.js";
import { parseRoadmap } from "./files.js";
import {
  formatExecuteTaskRecoveryStatus,
  inspectExecuteTaskDurability,
  readUnitRuntimeRecord,
  writeUnitRuntimeRecord,
} from "./unit-runtime.js";
import { runGit } from "./git-service.js";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

// ─── recoverTimedOutUnit ──────────────────────────────────────────────────────

/** Dependencies injected from auto.ts module-level state. */
export interface RecoveryDeps {
  currentUnit: { type: string; id: string; startedAt: number } | null;
  basePath: string;
  verbose: boolean;
  unitRecoveryCount: Map<string, number>;
  dispatchNextUnit: (ctx: ExtensionContext, pi: ExtensionAPI) => Promise<void>;
}

export async function recoverTimedOutUnit(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  unitType: string,
  unitId: string,
  reason: "idle" | "hard",
  deps: RecoveryDeps,
): Promise<"recovered" | "paused"> {
  const { currentUnit, basePath, verbose, unitRecoveryCount, dispatchNextUnit } = deps;
  if (!currentUnit) return "paused";

  const runtime = readUnitRuntimeRecord(basePath, unitType, unitId);
  const recoveryAttempts = runtime?.recoveryAttempts ?? 0;
  const maxRecoveryAttempts = reason === "idle" ? 2 : 1;

  const recoveryKey = `${unitType}/${unitId}`;
  const attemptNumber = (unitRecoveryCount.get(recoveryKey) ?? 0) + 1;
  unitRecoveryCount.set(recoveryKey, attemptNumber);

  if (attemptNumber > 1) {
    // Exponential backoff: 2^(n-1) seconds, capped at 30s
    const backoffMs = Math.min(1000 * Math.pow(2, attemptNumber - 2), 30000);
    ctx.ui.notify(
      `Recovery attempt ${attemptNumber} for ${unitType} ${unitId}. Waiting ${backoffMs / 1000}s before retry.`,
      "info",
    );
    await new Promise(r => setTimeout(r, backoffMs));
  }

  if (unitType === "execute-task") {
    const status = await inspectExecuteTaskDurability(basePath, unitId);
    if (!status) return "paused";

    writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
      recovery: status,
    });

    const durableComplete = status.summaryExists && status.taskChecked && status.nextActionAdvanced;
    if (durableComplete) {
      writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
        phase: "finalized",
        recovery: status,
      });
      ctx.ui.notify(
        `${reason === "idle" ? "Idle" : "Timeout"} recovery: ${unitType} ${unitId} already completed on disk. Continuing auto-mode. (attempt ${attemptNumber})`,
        "info",
      );
      unitRecoveryCount.delete(recoveryKey);
      await dispatchNextUnit(ctx, pi);
      return "recovered";
    }

    if (recoveryAttempts < maxRecoveryAttempts) {
      const isEscalation = recoveryAttempts > 0;
      writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
        phase: "recovered",
        recovery: status,
        recoveryAttempts: recoveryAttempts + 1,
        lastRecoveryReason: reason,
        lastProgressAt: Date.now(),
        progressCount: (runtime?.progressCount ?? 0) + 1,
        lastProgressKind: reason === "idle" ? "idle-recovery-retry" : "hard-recovery-retry",
      });

      const steeringLines = isEscalation
        ? [
            `**FINAL ${reason === "idle" ? "IDLE" : "HARD TIMEOUT"} RECOVERY — last chance before this task is skipped.**`,
            `You are still executing ${unitType} ${unitId}.`,
            `Recovery attempt ${recoveryAttempts + 1} of ${maxRecoveryAttempts}.`,
            `Current durability status: ${formatExecuteTaskRecoveryStatus(status)}.`,
            "You MUST finish the durable output NOW, even if incomplete.",
            "Write the task summary with whatever you have accomplished so far.",
            "Mark the task [x] in the plan. Commit your work.",
            "A partial summary is infinitely better than no summary.",
          ]
        : [
            `**${reason === "idle" ? "IDLE" : "HARD TIMEOUT"} RECOVERY — do not stop.**`,
            `You are still executing ${unitType} ${unitId}.`,
            `Recovery attempt ${recoveryAttempts + 1} of ${maxRecoveryAttempts}.`,
            `Current durability status: ${formatExecuteTaskRecoveryStatus(status)}.`,
            "Do not keep exploring.",
            "Immediately finish the required durable output for this unit.",
            "If full completion is impossible, write the partial artifact/state needed for recovery and make the blocker explicit.",
          ];

      pi.sendMessage(
        {
          customType: "gsd-auto-timeout-recovery",
          display: verbose,
          content: steeringLines.join("\n"),
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
      ctx.ui.notify(
        `${reason === "idle" ? "Idle" : "Timeout"} recovery: steering ${unitType} ${unitId} to finish durable output (attempt ${attemptNumber}, session ${recoveryAttempts + 1}/${maxRecoveryAttempts}).`,
        "warning",
      );
      return "recovered";
    }

    // Retries exhausted — write missing durable artifacts and advance.
    const diagnostic = formatExecuteTaskRecoveryStatus(status);
    const [mid, sid, tid] = unitId.split("/");
    const skipped = mid && sid && tid
      ? skipExecuteTask(basePath, mid, sid, tid, status, reason, maxRecoveryAttempts)
      : false;

    if (skipped) {
      writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
        phase: "skipped",
        recovery: status,
        recoveryAttempts: recoveryAttempts + 1,
        lastRecoveryReason: reason,
      });
      ctx.ui.notify(
        `${unitType} ${unitId} skipped after ${maxRecoveryAttempts} recovery attempts (${diagnostic}). Blocker artifacts written. Advancing pipeline. (attempt ${attemptNumber})`,
        "warning",
      );
      unitRecoveryCount.delete(recoveryKey);
      await dispatchNextUnit(ctx, pi);
      return "recovered";
    }

    // Fallback: couldn't write skip artifacts — pause as before.
    writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
      phase: "paused",
      recovery: status,
      recoveryAttempts: recoveryAttempts + 1,
      lastRecoveryReason: reason,
    });
    ctx.ui.notify(
      `${reason === "idle" ? "Idle" : "Timeout"} recovery check for ${unitType} ${unitId}: ${diagnostic}`,
      "warning",
    );
    return "paused";
  }

  const expected = diagnoseExpectedArtifact(unitType, unitId, basePath) ?? "required durable artifact";

  // Check if the artifact already exists on disk — agent may have written it
  // without signaling completion.
  const artifactPath = resolveExpectedArtifactPath(unitType, unitId, basePath);
  if (artifactPath && existsSync(artifactPath)) {
    writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
      phase: "finalized",
      recoveryAttempts: recoveryAttempts + 1,
      lastRecoveryReason: reason,
    });
    ctx.ui.notify(
      `${reason === "idle" ? "Idle" : "Timeout"} recovery: ${unitType} ${unitId} artifact already exists on disk. Advancing. (attempt ${attemptNumber})`,
      "info",
    );
    unitRecoveryCount.delete(recoveryKey);
    await dispatchNextUnit(ctx, pi);
    return "recovered";
  }

  if (recoveryAttempts < maxRecoveryAttempts) {
    const isEscalation = recoveryAttempts > 0;
    writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
      phase: "recovered",
      recoveryAttempts: recoveryAttempts + 1,
      lastRecoveryReason: reason,
      lastProgressAt: Date.now(),
      progressCount: (runtime?.progressCount ?? 0) + 1,
      lastProgressKind: reason === "idle" ? "idle-recovery-retry" : "hard-recovery-retry",
    });

    const steeringLines = isEscalation
      ? [
          `**FINAL ${reason === "idle" ? "IDLE" : "HARD TIMEOUT"} RECOVERY — last chance before skip.**`,
          `You are still executing ${unitType} ${unitId}.`,
          `Recovery attempt ${recoveryAttempts + 1} of ${maxRecoveryAttempts} — next failure skips this unit.`,
          `Expected durable output: ${expected}.`,
          "You MUST write the artifact file NOW, even if incomplete.",
          "Write whatever you have — partial research, preliminary findings, best-effort analysis.",
          "A partial artifact is infinitely better than no artifact.",
          "If you are truly blocked, write the file with a BLOCKER section explaining why.",
        ]
      : [
          `**${reason === "idle" ? "IDLE" : "HARD TIMEOUT"} RECOVERY — stay in auto-mode.**`,
          `You are still executing ${unitType} ${unitId}.`,
          `Recovery attempt ${recoveryAttempts + 1} of ${maxRecoveryAttempts}.`,
          `Expected durable output: ${expected}.`,
          "Stop broad exploration.",
          "Write the required artifact now.",
          "If blocked, write the partial artifact and explicitly record the blocker instead of going silent.",
        ];

    pi.sendMessage(
      {
        customType: "gsd-auto-timeout-recovery",
        display: verbose,
        content: steeringLines.join("\n"),
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
    ctx.ui.notify(
      `${reason === "idle" ? "Idle" : "Timeout"} recovery: steering ${unitType} ${unitId} to produce ${expected} (attempt ${attemptNumber}, session ${recoveryAttempts + 1}/${maxRecoveryAttempts}).`,
      "warning",
    );
    return "recovered";
  }

  // Retries exhausted — write a blocker placeholder and advance the pipeline
  // instead of silently stalling.
  const placeholder = writeBlockerPlaceholder(
    unitType, unitId, basePath,
    `${reason} recovery exhausted ${maxRecoveryAttempts} attempts without producing the artifact.`,
  );

  if (placeholder) {
    writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
      phase: "skipped",
      recoveryAttempts: recoveryAttempts + 1,
      lastRecoveryReason: reason,
    });
    ctx.ui.notify(
      `${unitType} ${unitId} skipped after ${maxRecoveryAttempts} recovery attempts. Blocker placeholder written to ${placeholder}. Advancing pipeline. (attempt ${attemptNumber})`,
      "warning",
    );
    unitRecoveryCount.delete(recoveryKey);
    await dispatchNextUnit(ctx, pi);
    return "recovered";
  }

  // Fallback: couldn't resolve artifact path — pause as before.
  writeUnitRuntimeRecord(basePath, unitType, unitId, currentUnit.startedAt, {
    phase: "paused",
    recoveryAttempts: recoveryAttempts + 1,
    lastRecoveryReason: reason,
  });
  return "paused";
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Write skip artifacts for a stuck execute-task: a blocker task summary and
 * the [x] checkbox in the slice plan. Returns true if artifacts were written.
 */
export function skipExecuteTask(
  base: string, mid: string, sid: string, tid: string,
  status: { summaryExists: boolean; taskChecked: boolean },
  reason: string, maxAttempts: number,
): boolean {
  // Write a blocker task summary if missing.
  if (!status.summaryExists) {
    const tasksDir = resolveTasksDir(base, mid, sid);
    const sDir = resolveSlicePath(base, mid, sid);
    const targetDir = tasksDir ?? (sDir ? join(sDir, "tasks") : null);
    if (!targetDir) return false;
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const summaryPath = join(targetDir, buildTaskFileName(tid, "SUMMARY"));
    const content = [
      `# BLOCKER — task skipped by auto-mode recovery`,
      ``,
      `Task \`${tid}\` in slice \`${sid}\` (milestone \`${mid}\`) failed to complete after ${reason} recovery exhausted ${maxAttempts} attempts.`,
      ``,
      `This placeholder was written by auto-mode so the pipeline can advance.`,
      `Review this task manually and replace this file with a real summary.`,
    ].join("\n");
    writeFileSync(summaryPath, content, "utf-8");
  }

  // Mark [x] in the slice plan if not already checked.
  if (!status.taskChecked) {
    const planAbs = resolveSliceFile(base, mid, sid, "PLAN");
    if (planAbs && existsSync(planAbs)) {
      const planContent = readFileSync(planAbs, "utf-8");
      const escapedTid = tid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^(- \\[) \\] (\\*\\*${escapedTid}:)`, "m");
      if (re.test(planContent)) {
        writeFileSync(planAbs, planContent.replace(re, "$1x] $2"), "utf-8");
      }
    }
  }

  return true;
}

/**
 * Detect whether the agent is producing work on disk by checking git for
 * any working-tree changes (staged, unstaged, or untracked). Returns true
 * if there are uncommitted changes — meaning the agent is actively working,
 * even though it hasn't signaled progress through runtime records.
 */
export function detectWorkingTreeActivity(cwd: string): boolean {
  try {
    const out = execSync("git status --porcelain", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return out.toString().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the expected artifact for a non-execute-task unit to an absolute path.
 * Returns null for unit types that don't produce a single file (execute-task,
 * complete-slice, replan-slice).
 */
export function resolveExpectedArtifactPath(unitType: string, unitId: string, base: string): string | null {
  const parts = unitId.split("/");
  const mid = parts[0]!;
  const sid = parts[1];
  switch (unitType) {
    case "research-milestone": {
      const dir = resolveMilestonePath(base, mid);
      return dir ? join(dir, buildMilestoneFileName(mid, "RESEARCH")) : null;
    }
    case "plan-milestone": {
      const dir = resolveMilestonePath(base, mid);
      return dir ? join(dir, buildMilestoneFileName(mid, "ROADMAP")) : null;
    }
    case "research-slice": {
      if (!sid) return null;
      const dir = resolveSlicePath(base, mid, sid);
      return dir ? join(dir, buildSliceFileName(sid, "RESEARCH")) : null;
    }
    case "plan-slice": {
      if (!sid) return null;
      const dir = resolveSlicePath(base, mid, sid);
      return dir ? join(dir, buildSliceFileName(sid, "PLAN")) : null;
    }
    case "reassess-roadmap": {
      if (!sid) return null;
      const dir = resolveSlicePath(base, mid, sid);
      return dir ? join(dir, buildSliceFileName(sid, "ASSESSMENT")) : null;
    }
    case "run-uat": {
      if (!sid) return null;
      const dir = resolveSlicePath(base, mid, sid);
      return dir ? join(dir, buildSliceFileName(sid, "UAT-RESULT")) : null;
    }
    case "execute-task": {
      if (!sid) return null;
      const tid = parts[2];
      const dir = resolveSlicePath(base, mid, sid);
      return dir && tid ? join(dir, "tasks", buildTaskFileName(tid, "SUMMARY")) : null;
    }
    case "complete-slice": {
      if (!sid) return null;
      const dir = resolveSlicePath(base, mid, sid);
      return dir ? join(dir, buildSliceFileName(sid, "SUMMARY")) : null;
    }
    case "complete-milestone": {
      const dir = resolveMilestonePath(base, mid);
      return dir ? join(dir, buildMilestoneFileName(mid, "SUMMARY")) : null;
    }
    case "fix-merge":
      return null;
    default:
      return null;
  }
}

/**
 * Check whether the expected artifact(s) for a unit exist on disk.
 * Returns true if all required artifacts exist, or if the unit type has no
 * single verifiable artifact (e.g., replan-slice).
 *
 * complete-slice requires both SUMMARY and UAT files — verifying only
 * the summary allowed the unit to be marked complete when the LLM
 * skipped writing the UAT file (see #176).
 */
export function verifyExpectedArtifact(unitType: string, unitId: string, base: string): boolean {
  // fix-merge has no file artifact — verify by checking git state
  if (unitType === "fix-merge") {
    const unmerged = runGit(base, ["diff", "--name-only", "--diff-filter=U"], { allowFailure: true });
    if (unmerged && unmerged.trim()) return false;
    if (existsSync(join(base, ".git", "MERGE_HEAD"))) return false;
    if (existsSync(join(base, ".git", "SQUASH_MSG"))) return false;
    return true;
  }

  const absPath = resolveExpectedArtifactPath(unitType, unitId, base);
  // Unit types with no verifiable artifact always pass (e.g. replan-slice).
  // For all other types, null means the parent directory is missing on disk
  // — treat as stale completion state so the key gets evicted (#313).
  if (!absPath) return unitType === "replan-slice";
  if (!existsSync(absPath)) return false;

  // execute-task must also have its checkbox marked [x] in the slice plan
  if (unitType === "execute-task") {
    const parts = unitId.split("/");
    const mid = parts[0];
    const sid = parts[1];
    const tid = parts[2];
    if (mid && sid && tid) {
      const planAbs = resolveSliceFile(base, mid, sid, "PLAN");
      if (planAbs && existsSync(planAbs)) {
        const planContent = readFileSync(planAbs, "utf-8");
        const escapedTid = tid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`^- \\[[xX]\\] \\*\\*${escapedTid}:`, "m");
        if (!re.test(planContent)) return false;
      }
    }
  }

  // complete-slice must also produce a UAT file AND mark the slice [x] in the roadmap.
  // Without the roadmap check, a crash after writing SUMMARY+UAT but before updating
  // the roadmap causes an infinite skip loop: the idempotency key says "done" but the
  // state machine keeps returning the same complete-slice unit (roadmap still shows
  // the slice incomplete), so dispatchNextUnit recurses forever.
  if (unitType === "complete-slice") {
    const parts = unitId.split("/");
    const mid = parts[0];
    const sid = parts[1];
    if (mid && sid) {
      const dir = resolveSlicePath(base, mid, sid);
      if (dir) {
        const uatPath = join(dir, buildSliceFileName(sid, "UAT"));
        if (!existsSync(uatPath)) return false;
      }
      // Verify the roadmap has the slice marked [x]. If not, the completion
      // record is stale — the unit must re-run to update the roadmap.
      const roadmapFile = resolveMilestoneFile(base, mid, "ROADMAP");
      if (roadmapFile && existsSync(roadmapFile)) {
        try {
          const roadmapContent = readFileSync(roadmapFile, "utf-8");
          const roadmap = parseRoadmap(roadmapContent);
          const slice = roadmap.slices.find(s => s.id === sid);
          if (slice && !slice.done) return false;
        } catch { /* corrupt roadmap — be lenient and treat as verified */ }
      }
    }
  }

  return true;
}

/**
 * Write a placeholder artifact so the pipeline can advance past a stuck unit.
 * Returns the relative path written, or null if the path couldn't be resolved.
 */
export function writeBlockerPlaceholder(unitType: string, unitId: string, base: string, reason: string): string | null {
  const absPath = resolveExpectedArtifactPath(unitType, unitId, base);
  if (!absPath) return null;
  const dir = dirname(absPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = [
    `# BLOCKER — auto-mode recovery failed`,
    ``,
    `Unit \`${unitType}\` for \`${unitId}\` failed to produce this artifact after idle recovery exhausted all retries.`,
    ``,
    `**Reason**: ${reason}`,
    ``,
    `This placeholder was written by auto-mode so the pipeline can advance.`,
    `Review and replace this file before relying on downstream artifacts.`,
  ].join("\n");
  writeFileSync(absPath, content, "utf-8");
  return diagnoseExpectedArtifact(unitType, unitId, base);
}

export function diagnoseExpectedArtifact(unitType: string, unitId: string, base: string): string | null {
  const parts = unitId.split("/");
  const mid = parts[0];
  const sid = parts[1];
  if (!mid) return null;
  switch (unitType) {
    case "research-milestone":
      return `${relMilestoneFile(base, mid, "RESEARCH")} (milestone research)`;
    case "plan-milestone":
      return `${relMilestoneFile(base, mid, "ROADMAP")} (milestone roadmap)`;
    case "research-slice":
      if (!sid) return null;
      return `${relSliceFile(base, mid, sid, "RESEARCH")} (slice research)`;
    case "plan-slice":
      if (!sid) return null;
      return `${relSliceFile(base, mid, sid, "PLAN")} (slice plan)`;
    case "execute-task": {
      if (!sid) return null;
      const tid = parts[2];
      return `Task ${tid} marked [x] in ${relSliceFile(base, mid, sid, "PLAN")} + summary written`;
    }
    case "complete-slice":
      if (!sid) return null;
      return `Slice ${sid} marked [x] in ${relMilestoneFile(base, mid, "ROADMAP")} + summary + UAT written`;
    case "replan-slice":
      if (!sid) return null;
      return `${relSliceFile(base, mid, sid, "REPLAN")} + updated ${relSliceFile(base, mid, sid, "PLAN")}`;
    case "reassess-roadmap":
      if (!sid) return null;
      return `${relSliceFile(base, mid, sid, "ASSESSMENT")} (roadmap reassessment)`;
    case "run-uat":
      if (!sid) return null;
      return `${relSliceFile(base, mid, sid, "UAT-RESULT")} (UAT result)`;
    case "complete-milestone":
      return `${relMilestoneFile(base, mid, "SUMMARY")} (milestone summary)`;
    case "fix-merge":
      return "Clean working tree with no unmerged files, no MERGE_HEAD, no SQUASH_MSG (merge conflict resolution)";
    default:
      return null;
  }
}

/**
 * Build concrete, manual remediation steps for a loop-detected unit failure.
 * These are shown when automatic reconciliation is not possible.
 */
export function buildLoopRemediationSteps(unitType: string, unitId: string, base: string): string | null {
  const parts = unitId.split("/");
  const mid = parts[0];
  const sid = parts[1];
  const tid = parts[2];
  switch (unitType) {
    case "execute-task": {
      if (!mid || !sid || !tid) break;
      const planRel = relSliceFile(base, mid, sid, "PLAN");
      const summaryRel = relTaskFile(base, mid, sid, tid, "SUMMARY");
      return [
        `   1. Write ${summaryRel} (even a partial summary is sufficient to unblock the pipeline)`,
        `   2. Mark ${tid} [x] in ${planRel}: change "- [ ] **${tid}:" → "- [x] **${tid}:"`,
        `   3. Run \`gsd doctor\` to reconcile .gsd/ state`,
        `   4. Resume auto-mode — it will pick up from the next task`,
      ].join("\n");
    }
    case "plan-slice":
    case "research-slice": {
      if (!mid || !sid) break;
      const artifactRel = unitType === "plan-slice"
        ? relSliceFile(base, mid, sid, "PLAN")
        : relSliceFile(base, mid, sid, "RESEARCH");
      return [
        `   1. Write ${artifactRel} manually (or with the LLM in interactive mode)`,
        `   2. Run \`gsd doctor\` to reconcile .gsd/ state`,
        `   3. Resume auto-mode`,
      ].join("\n");
    }
    case "complete-slice": {
      if (!mid || !sid) break;
      return [
        `   1. Write the slice summary and UAT file for ${sid} in ${relSlicePath(base, mid, sid)}`,
        `   2. Mark ${sid} [x] in ${relMilestoneFile(base, mid, "ROADMAP")}`,
        `   3. Run \`gsd doctor\` to reconcile .gsd/ state`,
        `   4. Resume auto-mode`,
      ].join("\n");
    }
    default:
      break;
  }
  return null;
}
