#!/usr/bin/env bun
/**
 * accord-morning — daily briefing from any harness, cron or CI.
 *
 *   accord-morning run      [--date YYYY-MM-DD] [--max-slack N] [--json]   gather + journal + draft objectives email
 *   accord-morning briefing [--date YYYY-MM-DD] [--max-slack N] [--json]   gather only
 *   accord-morning email    [--date D] [--to addr] [--send] [--force] [--json]
 *
 * `email` drafts by default; --send is required to deliver (at most once per ISO week).
 */

import {
  assembleBriefing,
  emailWeekObjectives,
  formatBriefingSummary,
  formatEmailResult,
  formatMorningRunSummary,
  runMorningPipeline,
} from "@clive.shirley/accord-core/morning/pipeline.js";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const opt: {
    date?: string;
    maxSlack?: number;
    to?: string;
    send: boolean;
    force: boolean;
    json: boolean;
  } = {
    send: false,
    force: false,
    json: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--date") opt.date = rest[++i];
    else if (a === "--max-slack") opt.maxSlack = Number(rest[++i]);
    else if (a === "--to") opt.to = rest[++i];
    else if (a === "--send") opt.send = true;
    else if (a === "--force") opt.force = true;
    else if (a === "--json") opt.json = true;
    else {
      console.error(`Unknown option: ${a}`);
      return 64;
    }
  }
  try {
    if (cmd === "run") {
      const r = await runMorningPipeline(opt.date, opt.maxSlack);
      console.log(opt.json ? JSON.stringify(r) : formatMorningRunSummary(r));
      return 0;
    }
    if (cmd === "briefing") {
      const r = await assembleBriefing(opt.date, opt.maxSlack);
      console.log(opt.json ? JSON.stringify(r) : formatBriefingSummary(r));
      return 0;
    }
    if (cmd === "email") {
      const r = await emailWeekObjectives({
        date: opt.date,
        to: opt.to,
        send: opt.send,
        force: opt.force,
      });
      console.log(opt.json ? JSON.stringify(r) : formatEmailResult(r));
      return r.status === "error" ? 1 : 0;
    }
  } catch (error) {
    console.error(
      `accord-morning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  console.error(
    "Usage: accord-morning run|briefing|email [--date D] [--max-slack N] [--to addr] [--send] [--force] [--json]",
  );
  return 64;
}

process.exit(await main(process.argv.slice(2)));
