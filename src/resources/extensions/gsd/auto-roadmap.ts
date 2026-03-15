/**
 * Roadmap slice progress cache — extracted from auto.ts.
 *
 * Provides synchronous access to milestone/slice progress for the
 * progress widget without requiring async I/O in render callbacks.
 */

import { resolveMilestoneFile, resolveSliceFile } from "./paths.js";
import { parseRoadmap, parsePlan } from "./files.js";
import { readFileSync, existsSync } from "node:fs";

/** Cached slice progress for the widget — avoid async in render */
let cachedSliceProgress: {
  done: number;
  total: number;
  milestoneId: string;
  /** Real task progress for the active slice, if its plan file exists */
  activeSliceTasks: { done: number; total: number } | null;
} | null = null;

export function updateSliceProgressCache(base: string, mid: string, activeSid?: string): void {
  try {
    const roadmapFile = resolveMilestoneFile(base, mid, "ROADMAP");
    if (!roadmapFile) return;
    const content = readFileSync(roadmapFile, "utf-8");
    const roadmap = parseRoadmap(content);

    let activeSliceTasks: { done: number; total: number } | null = null;
    if (activeSid) {
      try {
        const planFile = resolveSliceFile(base, mid, activeSid, "PLAN");
        if (planFile && existsSync(planFile)) {
          const planContent = readFileSync(planFile, "utf-8");
          const plan = parsePlan(planContent);
          activeSliceTasks = {
            done: plan.tasks.filter(t => t.done).length,
            total: plan.tasks.length,
          };
        }
      } catch {
        // Non-fatal — just omit task count
      }
    }

    cachedSliceProgress = {
      done: roadmap.slices.filter(s => s.done).length,
      total: roadmap.slices.length,
      milestoneId: mid,
      activeSliceTasks,
    };
  } catch {
    // Non-fatal — widget just won't show progress bar
  }
}

export function getRoadmapSlicesSync(): { done: number; total: number; activeSliceTasks: { done: number; total: number } | null } | null {
  return cachedSliceProgress;
}

export function resetSliceProgressCache(): void {
  cachedSliceProgress = null;
}
