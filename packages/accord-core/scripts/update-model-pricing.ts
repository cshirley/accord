#!/usr/bin/env bun
/**
 * Update packages/accord-core/schemas/model-pricing.json.
 *
 * Usage:
 *   bun run update:model-pricing -- --model <id> --input <usd_per_million> --output <usd_per_million> [--notes "..."]
 *   bun run update:model-pricing -- --model <id> --delete
 *   bun run update:model-pricing -- --list
 *   bun run update:model-pricing -- --fetch [--add-missing] [--dry-run]
 *
 * --fetch pulls LiteLLM's community-maintained source-of-truth
 * (model_prices_and_context_window.json, https://github.com/BerriAI/litellm) and syncs
 * input/output cost for every model_id already tracked here whose `litellm_provider` is
 * "anthropic" (direct API rates — not bedrock/vertex variants, not thinking/effort-suffixed
 * or Cursor composer-* ids, which LiteLLM doesn't carry). Pass --add-missing to also import
 * untracked base "claude-*" anthropic ids found upstream. --dry-run prints the diff only.
 *
 * Always bumps `updated` to today (UTC, YYYY-MM-DD) on any write. Validates the
 * resulting file is well-formed (default entry + input/output numbers for every
 * model) before saving.
 */

import * as path from "node:path";

const PRICING_PATH = path.join(
  import.meta.dir,
  "..",
  "schemas",
  "model-pricing.json",
);

interface PricingEntry {
  input: number;
  output: number;
}

interface PricingFile {
  schema_version: string;
  updated: string;
  unit: string;
  notes?: string;
  default: PricingEntry;
  models: Record<string, PricingEntry>;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

interface LiteLlmEntry {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

async function fetchPricing(file: PricingFile, addMissing: boolean, dryRun: boolean) {
  const res = await fetch(LITELLM_PRICES_URL);
  if (!res.ok) {
    throw new Error(`fetch ${LITELLM_PRICES_URL} failed: ${res.status} ${res.statusText}`);
  }
  const upstream = (await res.json()) as Record<string, LiteLlmEntry>;

  const changes: Array<{ id: string; before?: PricingEntry; after: PricingEntry }> = [];
  const skipped: string[] = [];

  for (const [id, entry] of Object.entries(file.models)) {
    const upstreamEntry = upstream[id];
    if (
      !upstreamEntry ||
      upstreamEntry.litellm_provider !== "anthropic" ||
      typeof upstreamEntry.input_cost_per_token !== "number" ||
      typeof upstreamEntry.output_cost_per_token !== "number"
    ) {
      skipped.push(id);
      continue;
    }
    const after: PricingEntry = {
      input: round(upstreamEntry.input_cost_per_token * 1_000_000),
      output: round(upstreamEntry.output_cost_per_token * 1_000_000),
    };
    if (after.input !== entry.input || after.output !== entry.output) {
      changes.push({ id, before: entry, after });
    }
  }

  if (addMissing) {
    for (const [id, entry] of Object.entries(upstream)) {
      if (id in file.models) continue;
      if (!/^claude-[a-z]+-\d(-\d+)?(-\d{8})?$/.test(id)) continue; // base ids only, no bedrock/vertex prefixes
      if (
        entry.litellm_provider !== "anthropic" ||
        typeof entry.input_cost_per_token !== "number" ||
        typeof entry.output_cost_per_token !== "number"
      ) {
        continue;
      }
      changes.push({
        id,
        after: {
          input: round(entry.input_cost_per_token * 1_000_000),
          output: round(entry.output_cost_per_token * 1_000_000),
        },
      });
    }
  }

  if (changes.length === 0) {
    console.log("No pricing changes — already in sync with LiteLLM.");
  } else {
    for (const { id, before, after } of changes) {
      if (before) {
        console.log(
          `${id}: input ${before.input}->${after.input}  output ${before.output}->${after.output}`,
        );
      } else {
        console.log(`${id}: NEW input=${after.input} output=${after.output}`);
      }
      if (!dryRun) file.models[id] = after;
    }
  }

  if (skipped.length > 0) {
    console.log(
      `Skipped (not in LiteLLM as direct anthropic rates): ${skipped.sort().join(", ")}`,
    );
  }

  if (dryRun || changes.length === 0) return false;

  file.models = Object.fromEntries(
    Object.entries(file.models).sort(([a], [b]) => a.localeCompare(b)),
  );
  return true;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function validate(file: PricingFile): void {
  if (typeof file.default?.input !== "number" || typeof file.default?.output !== "number") {
    throw new Error("default entry must have numeric input/output");
  }
  for (const [id, entry] of Object.entries(file.models)) {
    if (typeof entry.input !== "number" || typeof entry.output !== "number") {
      throw new Error(`model "${id}" must have numeric input/output`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file: PricingFile = JSON.parse(await Bun.file(PRICING_PATH).text());

  if (args.list) {
    console.log(`default: input=${file.default.input} output=${file.default.output}`);
    for (const [id, entry] of Object.entries(file.models).sort()) {
      console.log(`${id}: input=${entry.input} output=${entry.output}`);
    }
    return;
  }

  if (args.fetch) {
    const changed = await fetchPricing(file, Boolean(args["add-missing"]), Boolean(args["dry-run"]));
    if (!changed) return;
    file.updated = todayUtc();
    validate(file);
    await Bun.write(PRICING_PATH, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Updated ${PRICING_PATH} (updated=${file.updated}).`);
    return;
  }

  const model = args.model;
  if (typeof model !== "string") {
    console.error(
      "Usage: bun run update:model-pricing -- --model <id> --input <n> --output <n> [--notes \"...\"]",
    );
    console.error("       bun run update:model-pricing -- --model <id> --delete");
    console.error("       bun run update:model-pricing -- --list");
    console.error("       bun run update:model-pricing -- --fetch [--add-missing] [--dry-run]");
    process.exit(1);
  }

  if (args.delete) {
    if (!(model in file.models)) {
      console.error(`Model "${model}" not found — nothing to delete.`);
      process.exit(1);
    }
    delete file.models[model];
    console.log(`Deleted "${model}".`);
  } else {
    const input = Number(args.input);
    const output = Number(args.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      console.error("--input and --output must be numbers (usd_per_million_tokens).");
      process.exit(1);
    }
    file.models[model] = { input, output };
    // Keep keys sorted for a stable, reviewable diff.
    file.models = Object.fromEntries(
      Object.entries(file.models).sort(([a], [b]) => a.localeCompare(b)),
    );
    console.log(`Set "${model}": input=${input} output=${output}`);
  }

  if (typeof args.notes === "string") {
    file.notes = args.notes;
  }

  file.updated = todayUtc();
  validate(file);

  await Bun.write(PRICING_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Updated ${PRICING_PATH} (updated=${file.updated}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
