/**
 * Write or merge a daily journal entry (used by morning-run).
 */

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getMonday, normalizeItems, parseItem, resolveJournalPath } from "./common.js";
import { LAST_WEEK_RECAP_HEADER_RE } from "./weekly-carry-over.js";

const WEEK_HEADING_RE = /^## W\/C \d{4}-\d{2}-\d{2}\s+OBJECTIVES/;
const isWeekHeading = (line: string): boolean => WEEK_HEADING_RE.test(line);
const isDayHeading = (line: string): boolean => /^### \d{4}-\d{2}-\d{2}/.test(line);
const CARRY_HEADER_RE = /^\*\*Carried over from last week/;

/** End of a ### day entry: next day heading or next week block. */
function isDayEntryBoundary(line: string): boolean {
  return isDayHeading(line) || isWeekHeading(line);
}

/** Replaceable recap region under the current week heading, if present. */
function findRecapRegion(
  lines: string[],
  weekLine: number,
  regionEnd: number,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = weekLine + 1; i < regionEnd; i++) {
    if (LAST_WEEK_RECAP_HEADER_RE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = start + 1;
  while (end < regionEnd) {
    if (CARRY_HEADER_RE.test(lines[end])) break;
    const item = parseItem(lines[end]);
    if (item) {
      const isRecapDelivered = item.checkbox === "[x]";
      const isRecapOpen = item.checkbox === "[ ]" && /`not completed`/.test(item.text);
      if (!isRecapDelivered && !isRecapOpen) break;
    }
    end++;
  }
  while (end > start + 1 && lines[end - 1]?.trim() === "") end--;
  return { start, end };
}

export interface WriteJournalParams {
  date?: string;
  sections?: Record<string, string[]>;
  sectionsPath?: string;
  weeklyCarryOver?: string[];
  /** Lines for the last-week recap block (header + items). Written once per week. */
  lastWeekRecap?: string[];
  /** Bare checkbox lines for the ## W/C block (written only when the block has no items yet). */
  weekObjectives?: string[];
  journalPath?: string;
}

export async function writeJournalEntry(params: WriteJournalParams) {
  const journalPath = params.journalPath || resolveJournalPath();
  const content = readFileSync(journalPath, "utf-8");
  const lines = content.split("\n");

  // Resolve sections: prefer the inline `sections` arg; otherwise read them
  // from `sectionsPath` (the morning-briefing handoff — avoids the model ever
  // transcribing section contents).
  let rawSections = params.sections as Record<string, string[]> | undefined;
  let weekObjectivesFromFile: string[] | undefined;
  let consumedSectionsPath = "";
  if ((!rawSections || Object.keys(rawSections).length === 0) && params.sectionsPath) {
    const raw = params.sectionsPath.trim();
    const p = raw.startsWith("~")
      ? resolve(process.env.HOME || "", raw.slice(1).replace(/^\/+/, ""))
      : raw;
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as Record<string, string[]>;
    const { weekObjectives, ...rest } = parsed;
    weekObjectivesFromFile = weekObjectives;
    rawSections = rest;
    consumedSectionsPath = p;
  }

  // Normalize item lines so parseItem / carry-over / evening reconciliation work.
  const sections = { ...(rawSections || {}) };
  for (const key of Object.keys(sections) as Array<keyof typeof sections>) {
    const items = sections[key];
    if (items?.length) sections[key] = normalizeItems(items);
  }
  const weeklyCarryOver = params.weeklyCarryOver?.length
    ? normalizeItems(params.weeklyCarryOver)
    : params.weeklyCarryOver;
  const lastWeekRecap = params.lastWeekRecap?.length ? params.lastWeekRecap : undefined;
  const weekObjectives = params.weekObjectives?.length
    ? normalizeItems(params.weekObjectives)
    : weekObjectivesFromFile?.length
      ? normalizeItems(weekObjectivesFromFile)
      : undefined;

  const today = params.date || new Date().toISOString().slice(0, 10);
  const monday = getMonday(today);
  const now = new Date();
  const timestamp = `${today}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const weekHeadingText = `## W/C ${monday} OBJECTIVES`;

  // --- 1. Update frontmatter (only between --- delimiters) ---
  let fmEnd = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        fmEnd = i + 1;
        break;
      }
      if (lines[i].startsWith("updated:")) lines[i] = `updated: ${today}`;
      if (lines[i].startsWith("reconciled_at:")) lines[i] = `reconciled_at: ${timestamp}`;
      if (lines[i].startsWith("version:")) {
        const v = parseInt(lines[i].split(":")[1]?.trim() || "0", 10);
        lines[i] = `version: ${v + 1}`;
      }
      if (lines[i].startsWith("last_entry_date:")) lines[i] = `last_entry_date: ${today}`;
    }
  }

  // --- 2. Find or create ## W/C heading ---
  // Use exact match to avoid partial/prefix collisions
  let weekLine = lines.indexOf(weekHeadingText);

  if (weekLine === -1) {
    // Insert before the first existing ## W/C heading (or end of file)
    const firstWeekLine = lines.findIndex(
      (l, i) => i >= fmEnd && /^## W\/C \d{4}-\d{2}-\d{2}\s+OBJECTIVES/.test(l),
    );
    const insertAt = firstWeekLine !== -1 ? firstWeekLine : lines.length;

    const weekBlock: string[] = [weekHeadingText, ""];
    if (lastWeekRecap?.length) {
      weekBlock.push(...lastWeekRecap);
    }
    if (weeklyCarryOver?.length) {
      weekBlock.push("**Carried over from last week:**", "", ...weeklyCarryOver, "");
    }

    lines.splice(insertAt, 0, ...weekBlock);
    weekLine = insertAt;
  } else {
    if (lastWeekRecap?.length) {
      let regionEnd = weekLine + 1;
      while (
        regionEnd < lines.length &&
        !/^### /.test(lines[regionEnd]) &&
        !isWeekHeading(lines[regionEnd])
      ) {
        regionEnd++;
      }
      const recapRegion = findRecapRegion(lines, weekLine, regionEnd);
      if (recapRegion) {
        const oldLen = recapRegion.end - recapRegion.start;
        lines.splice(recapRegion.start, oldLen, ...lastWeekRecap);
      } else {
        lines.splice(weekLine + 1, 0, "", ...lastWeekRecap);
      }
    }

    if (weeklyCarryOver?.length) {
      // Heading exists — add carry-over only if not already present.
      // Scan the whole carry-over region (heading → first ### or ## ) and
      // detect BOTH the header marker and any existing carry-over item lines,
      // so a prior run that left bare items doesn't get a duplicate block.
      let regionEnd = weekLine + 1;
      while (
        regionEnd < lines.length &&
        !/^### /.test(lines[regionEnd]) &&
        !isWeekHeading(lines[regionEnd])
      ) {
        regionEnd++;
      }
      const region = lines.slice(weekLine + 1, regionEnd);
      const hasHeader = region.some((l) => l.startsWith("**Carried over"));
      const hasItems = region.some((l) => parseItem(l) !== null);
      if (!hasHeader && !hasItems) {
        const carryBlock = ["", "**Carried over from last week:**", "", ...weeklyCarryOver, ""];
        lines.splice(weekLine + 1, 0, ...carryBlock);
      }
    }
  }

  // Seed week objectives when the ## W/C block has no checkbox items yet.
  if (weekObjectives?.length) {
    let regionEnd = weekLine + 1;
    while (regionEnd < lines.length) {
      if (/^### /.test(lines[regionEnd])) break;
      if (isWeekHeading(lines[regionEnd])) break;
      regionEnd++;
    }
    const region = lines.slice(weekLine + 1, regionEnd);
    const hasItems = region.some((l) => parseItem(l) !== null);
    if (!hasItems) {
      lines.splice(weekLine + 1, 0, "", ...weekObjectives, "");
    }
  }

  // --- 3. Section ordering (needed to decide if we touch daily entries) ---
  const sectionOrder: Array<{ key: keyof typeof sections; heading: string }> = [
    { key: "gdpr", heading: "GDPR" },
    { key: "needsResponse", heading: "Needs response / action" },
    { key: "activeWork", heading: "Active work" },
    { key: "meetings", heading: "Meetings today" },
    { key: "docsToReview", heading: "Docs to review" },
    { key: "backlog", heading: "Backlog / FYI" },
    { key: "watched", heading: "Watched" },
  ];

  const hasDailySections = sectionOrder.some(({ key }) => sections[key]?.length);
  if (!hasDailySections) {
    if (fmEnd > 0) {
      const hasFmField = lines.slice(0, fmEnd).some((l) => l.startsWith("last_entry_date:"));
      if (!hasFmField) {
        lines.splice(fmEnd - 1, 0, `last_entry_date: ${today}`);
      }
    }
    writeFileSync(journalPath, lines.join("\n"), "utf-8");
    return {
      content: [{ type: "text", text: `Journal updated for ${today} (week block only).` }],
      details: {
        date: today,
        journalPath,
        counts: {},
        weeklyCarryOver: weeklyCarryOver?.length || 0,
      },
    };
  }

  // --- 4. Find the boundary of this week's block ---
  let weekEnd = weekLine + 1;
  while (weekEnd < lines.length) {
    // Stop at the next ## W/C heading (older week blocks in the journal).
    if (weekEnd > weekLine && isWeekHeading(lines[weekEnd])) break;
    weekEnd++;
  }

  // --- 5. Find or create ### YYYY-MM-DD entry (scoped to this week block) ---
  const entryHeading = `### ${today}`;
  let entryLine = -1;
  for (let i = weekLine + 1; i < weekEnd; i++) {
    if (lines[i] === entryHeading || lines[i].startsWith(`${entryHeading} `)) {
      entryLine = i;
      break;
    }
  }

  if (entryLine === -1) {
    // Insert after carry-over block, before existing ### entries
    let insertAt = weekLine + 1;
    while (insertAt < weekEnd && !lines[insertAt].startsWith("### ")) {
      insertAt++;
    }
    lines.splice(insertAt, 0, entryHeading, "");
    entryLine = insertAt;
    weekEnd += 2;
  }

  // --- 6. Find the end of today's entry ---
  let entryEnd = entryLine + 1;
  while (entryEnd < lines.length && !isDayEntryBoundary(lines[entryEnd])) {
    entryEnd++;
  }

  // --- 7. Determine which sections already exist ---
  const existingSections = new Set<string>();
  for (let i = entryLine; i < entryEnd; i++) {
    const m = lines[i].match(/^####\s+(.*)/);
    if (m) existingSections.add(m[1]);
  }

  // --- 8. Meetings normalize + re-sync ---
  // Meetings are keyed on title AND time range so de-duplication is robust:
  //   - Incoming duplicates (e.g. the same event from two calendars) collapse
  //     to one line, so even a first-time write of the section is clean.
  //   - On re-run, an existing line is matched by title first, then by time
  //     range, so a renamed OR rescheduled meeting updates in place instead
  //     of being appended as a duplicate. Existing checkbox state ([x]/[~])
  //     is preserved so manual marks are not lost.
  const mTitle = (s: string): string => {
    const linked = s.match(/\[([^\]]+)\]\(/);
    if (linked) return linked[1].trim().toLowerCase();
    return s
      .replace(/^- \[[ x~>-]\]\s*/, "")
      .replace(/\d{2}:\d{2}[\u2013-]\d{2}:\d{2}/, "")
      .replace(/`[^`]*`/g, "")
      .trim()
      .toLowerCase();
  };
  const mTime = (s: string): string | undefined =>
    s.match(/(\d{2}:\d{2}[\u2013-]\d{2}:\d{2})/)?.[1];
  const mCheckbox = (s: string): string => s.match(/^- (\[[ x~>-]\])/)?.[1] ?? "[ ]";
  // Chronological sort key: start time "HH:MM"; items without a parseable
  // time (e.g. all-day) sort last.
  const mStartKey = (s: string): string => mTime(s)?.slice(0, 5) ?? "99:99";

  // De-dup the incoming meeting list on (title | time), then sort it
  // chronologically. Mutate sections.meetings so BOTH write paths order it:
  //   - the section-creation path (step 9) writes this list verbatim, so the
  //     FIRST write of the day is already sorted (previously it inherited the
  //     calendar API's arbitrary order and only got sorted on a later re-run);
  //   - the re-sync path below re-sorts anyway on subsequent runs.
  let meetingItems = sections.meetings;
  if (meetingItems?.length) {
    const seenIncoming = new Set<string>();
    meetingItems = meetingItems.filter((m) => {
      const key = `${mTitle(m)}|${mTime(m) ?? ""}`;
      if (seenIncoming.has(key)) return false;
      seenIncoming.add(key);
      return true;
    });
    meetingItems = [...meetingItems].sort((a, b) => mStartKey(a).localeCompare(mStartKey(b)));
    sections.meetings = meetingItems;
  }

  if (existingSections.has("Meetings today") && meetingItems?.length) {
    for (let i = entryLine; i < entryEnd; i++) {
      if (!/^####\s+Meetings today/.test(lines[i])) continue;

      let sectionEnd = i + 1;
      while (sectionEnd < entryEnd && !lines[sectionEnd].startsWith("####")) sectionEnd++;

      const consumed = new Set<number>();
      for (const item of meetingItems) {
        const newTitle = mTitle(item);
        const newTime = mTime(item);
        if (!newTitle && !newTime) continue;

        // Pass 1: match by title. Pass 2 (only if no title match): match by
        // time range, so a renamed meeting still updates its existing line.
        let matchIdx = -1;
        if (newTitle) {
          for (let k = i + 1; k < sectionEnd; k++) {
            if (consumed.has(k) || !/^- \[[ x~>-]\]/.test(lines[k])) continue;
            if (mTitle(lines[k]) === newTitle) {
              matchIdx = k;
              break;
            }
          }
        }
        if (matchIdx === -1 && newTime) {
          for (let k = i + 1; k < sectionEnd; k++) {
            if (consumed.has(k) || !/^- \[[ x~>-]\]/.test(lines[k])) continue;
            if (mTime(lines[k]) === newTime) {
              matchIdx = k;
              break;
            }
          }
        }

        if (matchIdx === -1) {
          // Genuinely new meeting — append at the end of the section.
          lines.splice(sectionEnd, 0, item);
          consumed.add(sectionEnd);
          sectionEnd++;
          entryEnd++;
        } else {
          // Existing meeting — refresh title/time/link, preserving checkbox.
          consumed.add(matchIdx);
          const existingCheckbox = mCheckbox(lines[matchIdx]);
          const sameTime = mTime(lines[matchIdx]) === newTime;
          const sameTitle = mTitle(lines[matchIdx]) === newTitle;
          const hasLink = lines[matchIdx].includes("](");
          if (!sameTime || !sameTitle || !hasLink) {
            lines[matchIdx] = item.replace(/^- \[[ x~>-]\]/, `- ${existingCheckbox}`);
          }
        }
      }

      // Re-sort the section chronologically by start time so newly-appended
      // meetings slot into place instead of piling up at the bottom. Stable
      // sort keeps same-start meetings in their existing order; items without
      // a parseable time (e.g. all-day) sort last. Also collapses stray blank
      // lines to a single trailing blank before the next heading.
      const itemLines: string[] = [];
      const otherLines: string[] = [];
      for (let k = i + 1; k < sectionEnd; k++) {
        if (/^- \[[ x~>-]\]/.test(lines[k])) itemLines.push(lines[k]);
        else if (lines[k].trim()) otherLines.push(lines[k]);
      }
      itemLines.sort((a, b) => mStartKey(a).localeCompare(mStartKey(b)));
      const rebuilt = [...itemLines, ...otherLines, ""];
      const oldLen = sectionEnd - (i + 1);
      lines.splice(i + 1, oldLen, ...rebuilt);
      entryEnd += rebuilt.length - oldLen;
      break;
    }
  }

  // --- 8.5 Item-level merge for existing (non-meeting) sections ---
  // When a section heading already exists for today, don't skip the whole
  // section (which would drop freshly-gathered items) and don't re-insert it
  // (which would duplicate manual edits). Instead merge item-by-item, keyed
  // on Jira key first, then normalized text (checkbox + recency badges
  // stripped) so items you've edited, moved, or already have are not
  // duplicated. Meetings are excluded — they have their own title-based
  // re-sync above.
  const itemKey = (line: string): string | null => {
    const it = parseItem(line);
    if (!it) return null;
    if (it.jiraKey) return `jira:${it.jiraKey}`;
    const cleaned = it.text
      .replace(
        /\s*`(today|yesterday|Friday|Thursday|Wednesday|Tuesday|Monday|carried over|\d+ days? ago)`/gi,
        "",
      )
      .trim()
      .toLowerCase()
      .slice(0, 80);
    return cleaned ? `txt:${cleaned}` : null;
  };

  for (const { key, heading } of sectionOrder) {
    if (heading === "Meetings today") continue;
    const items = sections[key];
    if (!items?.length) continue;
    if (!existingSections.has(heading)) continue; // brand-new sections handled in step 9

    // Recompute entry bounds fresh — prior merges may have shifted lines.
    let eEnd = entryLine + 1;
    while (eEnd < lines.length && !isDayEntryBoundary(lines[eEnd])) eEnd++;

    let hIdx = -1;
    for (let i = entryLine + 1; i < eEnd; i++) {
      const m = lines[i].match(/^####\s+(.*)/);
      if (m && m[1] === heading) {
        hIdx = i;
        break;
      }
    }
    if (hIdx === -1) continue;

    let sEnd = hIdx + 1;
    while (sEnd < eEnd && !lines[sEnd].startsWith("####")) sEnd++;

    const existingKeys = new Set<string>();
    for (let i = hIdx + 1; i < sEnd; i++) {
      const k = itemKey(lines[i]);
      if (k) existingKeys.add(k);
    }

    const toAdd: string[] = [];
    for (const item of items) {
      const k = itemKey(item);
      if (k && existingKeys.has(k)) continue;
      if (k) existingKeys.add(k);
      toAdd.push(item);
    }

    if (toAdd.length) {
      // Insert after the last non-blank content line (handles multi-line
      // items and trailing blank lines without splitting an item).
      let insertPos = sEnd;
      while (insertPos - 1 > hIdx && lines[insertPos - 1].trim() === "") insertPos--;
      lines.splice(insertPos, 0, ...toAdd);
    }
  }

  // --- 9. Build and insert new sections (skip existing) ---
  const newLines: string[] = [];
  for (const { key, heading } of sectionOrder) {
    const items = sections[key];
    if (!items?.length) continue;
    if (existingSections.has(heading)) continue;
    newLines.push(`#### ${heading}`, "", ...items, "");
  }

  if (newLines.length) {
    // Re-calculate entryEnd since meetings re-sync may have shifted it
    entryEnd = entryLine + 1;
    while (entryEnd < lines.length && !isDayEntryBoundary(lines[entryEnd])) {
      entryEnd++;
    }
    lines.splice(entryEnd, 0, ...newLines);
  }

  // If last_entry_date doesn't exist in frontmatter, add it
  if (fmEnd > 0) {
    const hasFmField = lines.slice(0, fmEnd).some((l) => l.startsWith("last_entry_date:"));
    if (!hasFmField) {
      lines.splice(fmEnd - 1, 0, `last_entry_date: ${today}`);
    }
  }

  writeFileSync(journalPath, lines.join("\n"), "utf-8");

  // Clean up the one-shot payload file now its contents are safely persisted.
  if (consumedSectionsPath) {
    try {
      unlinkSync(consumedSectionsPath);
    } catch {
      /* already gone / not deletable — harmless */
    }
  }

  // --- Summary ---
  const counts: Record<string, number> = {};
  for (const { key, heading } of sectionOrder) {
    const items = sections[key];
    if (items?.length) counts[heading] = items.length;
  }
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  return {
    content: [{ type: "text", text: `Journal updated for ${today}. ${summary}` }],
    details: { date: today, journalPath, counts, weeklyCarryOver: weeklyCarryOver?.length || 0 },
  };
}
