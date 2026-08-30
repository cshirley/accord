/**
 * Classify plan task `steps[]` tags into harness pipeline requirements.
 *
 * Plan steps use `tag: "test" | "impl" | "verify"`. A task may mix tags; the
 * capstone pattern is **verify-only** (final gate) with no test/impl steps.
 */

export type PlanTaskStepTag = "test" | "impl" | "verify";

export interface PlanTaskStep {
  tag?: string;
  description?: string;
}

export interface PlanTaskPipelineProfile {
  hasTest: boolean;
  hasImpl: boolean;
  hasVerify: boolean;
  /** True when the task has verify step(s) and no test or impl steps. */
  verifyOnly: boolean;
  initialPhase: "phase-test" | "phase-verify-task";
  preImplGates: "pending" | "complete";
}

function isPlanTaskStepTag(value: string): value is PlanTaskStepTag {
  return value === "test" || value === "impl" || value === "verify";
}

export function planTaskPipelineProfile(steps: PlanTaskStep[] | undefined): PlanTaskPipelineProfile {
  const tags = new Set<PlanTaskStepTag>();
  for (const step of steps ?? []) {
    const tag = typeof step.tag === "string" ? step.tag.trim() : "";
    if (isPlanTaskStepTag(tag)) {
      tags.add(tag);
    }
  }

  const hasTest = tags.has("test");
  const hasImpl = tags.has("impl");
  const hasVerify = tags.has("verify");
  const verifyOnly = hasVerify && !hasTest && !hasImpl;

  if (verifyOnly) {
    return {
      hasTest,
      hasImpl,
      hasVerify,
      verifyOnly: true,
      initialPhase: "phase-verify-task",
      preImplGates: "complete",
    };
  }

  return {
    hasTest,
    hasImpl,
    hasVerify,
    verifyOnly: false,
    initialPhase: "phase-test",
    preImplGates: "pending",
  };
}

export function verifyStepDescriptions(steps: PlanTaskStep[] | undefined): string[] {
  return (steps ?? [])
    .filter((s) => s.tag === "verify")
    .map((s) => (typeof s.description === "string" ? s.description.trim() : ""))
    .filter((d) => d.length > 0);
}
