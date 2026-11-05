import { createGhStackProvider } from "./gh-provider.js";

export type StackPrState = "open" | "closed" | "merged";

export interface StackPr {
  number: number;
  url: string;
  state: StackPrState;
  head: string;
  base: string;
}

export interface CreateOrUpdatePrInput {
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface UpsertStackMapCommentInput {
  pr: number;
  workItemId: string;
  body: string;
}

export type EvidenceState = "pending" | "success" | "failure" | "error";

export interface SetEvidenceStatusInput {
  sha: string;
  state: EvidenceState;
  description?: string;
}

export interface ListPrsInput {
  head?: string;
  state?: StackPrState | "all";
}

export interface StackProvider {
  createOrUpdatePr(input: CreateOrUpdatePrInput): Promise<{ number: number; url: string }>;
  upsertStackMapComment(input: UpsertStackMapCommentInput): Promise<void>;
  setEvidenceStatus(input: SetEvidenceStatusInput): Promise<void>;
  listPrs(input?: ListPrsInput): Promise<StackPr[]>;
  ensureBranch(input: { branch: string; base: string }): Promise<void>;
  pushBranch(input: { branch: string }): Promise<void>;
  retarget(pr: number, base: string): Promise<void>;
}

export interface ResolveStackProviderOptions {
  cwd?: string;
}

export function resolveStackProvider(
  name: string,
  options?: ResolveStackProviderOptions,
): StackProvider {
  if (name === "gh") return createGhStackProvider(options);
  throw new Error(`Unsupported stack provider ${JSON.stringify(name)}; supported providers: gh`);
}
