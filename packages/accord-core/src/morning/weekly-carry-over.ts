/**
 * Weekly carry-over, last-week recap, and week-objectives seeding for the morning-briefing extension.
 */

export interface JournalItem {
  raw: string;
  checkbox: string;
  text: string;
  jiraKey?: string;
  badges: string[];
}

export interface JournalSection {
  heading: string;
  level: number;
  items: JournalItem[];
}

export interface DailyEntry {
  date: string;
  line: number;
  sections: JournalSection[];
}

export interface WeeklyBlock {
  heading: string;
  weekStart: string;
  line: number;
  carryOver: string[];
  entries: DailyEntry[];
}

export interface PreviousWeekRecap {
  prevMonday: string;
  delivered: string[];
  stillOpen: string[];
}

const ACTIVE_WORK = "Active work";

export const LAST_WEEK_RECAP_HEADER_RE = /^\*\*Last week recap/;
const CARRY_HEADER_RE = /^\*\*Carried over from last week/;

function parseFrontmatter(lines: string[]): { bodyStart: number } {
  if (lines[0]?.trim() !== "---") return { bodyStart: 0 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return { bodyStart: i + 1 };
  }
  return { bodyStart: 0 };
}

export function parseItem(line: string): JournalItem | null {
  const m = line.match(/^- \[([ x~>-])\]\s+(.*)/);
  if (!m) return null;
  const checkbox = `[${m[1]}]`;
  const text = m[2];
  const jiraMatch = text.match(/\b(STEP|BDPC|CR|THMC|CLD)-\d+\b/);
  const badges = [...text.matchAll(/`([^`]+)`/g)].map((b) => b[1]);
  return { raw: line, checkbox, text, jiraKey: jiraMatch?.[0], badges };
}

export function parseJournal(content: string): { weeks: WeeklyBlock[] } {
  const lines = content.split("\n");
  const { bodyStart } = parseFrontmatter(lines);

  const weeks: WeeklyBlock[] = [];
  let currentWeek: WeeklyBlock | null = null;
  let currentEntry: DailyEntry | null = null;
  let currentSection: JournalSection | null = null;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];

    const weekMatch = line.match(/^## W\/C (\d{4}-\d{2}-\d{2})\s+OBJECTIVES/);
    if (weekMatch) {
      currentEntry = null;
      currentSection = null;
      currentWeek = {
        heading: line.replace(/^## /, ""),
        weekStart: weekMatch[1],
        line: i,
        carryOver: [],
        entries: [],
      };
      weeks.push(currentWeek);
      continue;
    }

    const dayMatch = line.match(/^### (\d{4}-\d{2}-\d{2})/);
    if (dayMatch) {
      if (!currentWeek) {
        const entryMonday = getMonday(dayMatch[1]);
        currentWeek = {
          heading: `W/C ${entryMonday} OBJECTIVES`,
          weekStart: entryMonday,
          line: i,
          carryOver: [],
          entries: [],
        };
        weeks.push(currentWeek);
      }
      currentSection = null;
      currentEntry = { date: dayMatch[1], line: i, sections: [] };
      currentWeek.entries.push(currentEntry);
      continue;
    }

    const sectionMatch = line.match(/^(#{4,})\s+(.*)/);
    if (sectionMatch && currentEntry) {
      currentSection = { heading: sectionMatch[2], level: sectionMatch[1].length, items: [] };
      currentEntry.sections.push(currentSection);
      continue;
    }

    if (currentWeek && !currentEntry && line.trim()) {
      currentWeek.carryOver.push(line);
      continue;
    }

    if (currentSection) {
      const item = parseItem(line);
      if (item) currentSection.items.push(item);
    }
  }

  return { weeks };
}

export function getMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function prevMondayStr(forMonday: string): string {
  const d = new Date(`${forMonday}T12:00:00`);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function isOpenCheckbox(checkbox: string): boolean {
  return checkbox === "[ ]";
}

function isDoneCheckbox(checkbox: string): boolean {
  return checkbox === "[x]";
}

function isStillOpenForRecap(checkbox: string): boolean {
  return checkbox === "[ ]" || checkbox === "[~]" || checkbox === "[>]";
}

export function itemDedupKey(item: JournalItem): string {
  return (
    item.jiraKey ||
    item.text
      .replace(/\s*`[^`]+`/g, "")
      .trim()
      .slice(0, 80)
  );
}

function itemToLine(item: JournalItem): string {
  return `- ${item.checkbox} ${item.text}`;
}

const RECENCY_BADGE =
  /`(today|yesterday|Friday|Thursday|Wednesday|Tuesday|Monday|carried over|not completed|\d+ days? ago)`/g;

/** Rebuild an open carry-over line, preserving links/status badges and marking `carried over`. */
export function toCarriedOverLine(item: JournalItem): string {
  let text = item.text.replace(RECENCY_BADGE, "").replace(/\s+/g, " ").trim();
  if (!/`carried over`/.test(text)) text = `${text} \`carried over\``;
  return `- [ ] ${text}`;
}

function toRecapDeliveredLine(item: JournalItem): string {
  const text = item.text.replace(RECENCY_BADGE, "").replace(/\s+/g, " ").trim();
  return `- [x] ${text}`;
}

function toRecapOpenLine(item: JournalItem): string {
  let text = item.text.replace(RECENCY_BADGE, "").replace(/\s+/g, " ").trim();
  if (!/`not completed`/.test(text)) text = `${text} \`not completed\``;
  return `- [ ] ${text}`;
}

export function formatRecapHeader(prevMonday: string): string {
  return `**Last week recap (W/C ${prevMonday}):**`;
}

/** Journal lines for the recap block (header, items, trailing blank). */
export function formatLastWeekRecapBlock(recap: PreviousWeekRecap): string[] {
  const lines = [formatRecapHeader(recap.prevMonday), ""];
  lines.push(...recap.delivered, ...recap.stillOpen);
  lines.push("");
  return lines;
}

/**
 * Checkbox items that are this week's objectives (excludes last-week recap and carry-over subsections).
 */
export function extractObjectiveItems(carryOver: string[]): JournalItem[] {
  let mode: "legacy" | "recap" | "carried" | "objectives" = "legacy";
  const objectives: JournalItem[] = [];

  for (const line of carryOver) {
    if (LAST_WEEK_RECAP_HEADER_RE.test(line)) {
      mode = "recap";
      continue;
    }
    if (CARRY_HEADER_RE.test(line)) {
      mode = "carried";
      continue;
    }
    if (line.startsWith("**")) continue;

    const item = parseItem(line);
    if (!item) continue;

    if (mode === "recap") {
      const isRecapItem =
        item.checkbox === "[x]" || (item.checkbox === "[ ]" && /`not completed`/.test(item.text));
      if (!isRecapItem) {
        mode = "objectives";
        objectives.push(item);
      }
      continue;
    }

    if (mode === "carried" || mode === "objectives" || mode === "legacy") {
      objectives.push(item);
      if (mode === "legacy") mode = "objectives";
    }
  }

  return objectives;
}

/**
 * Extract the current week's objectives from parsed journal content.
 * Falls back to the earliest daily Active work section when the objectives block is empty.
 */
export function extractWeekObjectives(content: string, monday: string): string[] {
  const { weeks } = parseJournal(content);
  const week = weeks.find((w) => w.weekStart === monday);
  if (!week) return [];

  const fromBlock = extractObjectiveItems(week.carryOver).map(itemToLine);
  if (fromBlock.length) return fromBlock;

  const sortedEntries = [...week.entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sortedEntries) {
    for (const section of entry.sections) {
      if (section.heading !== ACTIVE_WORK) continue;
      if (section.items.length) return section.items.map(itemToLine);
    }
  }

  return [];
}

interface WeekItemState {
  item: JournalItem;
  checkbox: string;
  date: string;
}

function collectWeekItemStates(prevWeek: WeeklyBlock): {
  latest: Map<string, WeekItemState>;
  objectiveOrder: string[];
} {
  const objectiveItems = extractObjectiveItems(prevWeek.carryOver);
  const objectiveOrder = objectiveItems.map(itemDedupKey);
  const objectiveByKey = new Map(objectiveItems.map((item) => [itemDedupKey(item), item]));

  const allOccurrences = new Map<string, WeekItemState[]>();
  const record = (item: JournalItem, date: string) => {
    const key = itemDedupKey(item);
    if (!allOccurrences.has(key)) allOccurrences.set(key, []);
    allOccurrences.get(key)?.push({ item, checkbox: item.checkbox, date });
  };

  const sortedEntries = [...prevWeek.entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sortedEntries) {
    for (const section of entry.sections) {
      if (section.heading !== ACTIVE_WORK) continue;
      for (const item of section.items) {
        record(item, entry.date);
      }
    }
  }

  const latest = new Map<string, WeekItemState>();
  for (const [key, occs] of allOccurrences) {
    const mostRecent = [...occs].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (mostRecent) latest.set(key, mostRecent);
  }

  // Objectives that never appeared in daily Active work keep their block checkbox.
  for (const [key, item] of objectiveByKey) {
    if (!latest.has(key)) {
      latest.set(key, { item, checkbox: item.checkbox, date: prevWeek.weekStart });
    }
  }

  return { latest, objectiveOrder };
}

/**
 * Summarise the previous ISO week: objectives with final status plus any other
 * completed Active work items (de-duplicated by Jira key / text).
 */
export function computePreviousWeekRecap(
  content: string,
  forMonday: string,
): PreviousWeekRecap | null {
  const prevMonday = prevMondayStr(forMonday);
  const { weeks } = parseJournal(content);
  const prevWeek = weeks.find((w) => w.weekStart === prevMonday);
  if (!prevWeek) return null;

  const { latest, objectiveOrder } = collectWeekItemStates(prevWeek);
  const objectiveKeys = new Set(objectiveOrder);

  const delivered: string[] = [];
  const stillOpen: string[] = [];
  const deliveredKeys = new Set<string>();

  for (const key of objectiveOrder) {
    const state = latest.get(key);
    if (!state) continue;
    if (isDoneCheckbox(state.checkbox)) {
      delivered.push(toRecapDeliveredLine(state.item));
      deliveredKeys.add(key);
    } else if (isStillOpenForRecap(state.checkbox)) {
      stillOpen.push(toRecapOpenLine(state.item));
    }
  }

  const extras: { line: string; date: string }[] = [];
  for (const [key, state] of latest) {
    if (deliveredKeys.has(key) || objectiveKeys.has(key)) continue;
    if (!isDoneCheckbox(state.checkbox)) continue;
    extras.push({ line: toRecapDeliveredLine(state.item), date: state.date });
  }
  extras.sort((a, b) => a.date.localeCompare(b.date));
  delivered.push(...extras.map((e) => e.line));

  if (!delivered.length && !stillOpen.length) return null;

  return { prevMonday, delivered, stillOpen };
}

/**
 * Open items to carry from the previous ISO week into a new week's objectives.
 * Used when seeding a new week's objectives block on Monday.
 */
export function computeWeeklyCarryOverLines(content: string, forMonday: string): string[] {
  const prevMonday = prevMondayStr(forMonday);
  const { weeks } = parseJournal(content);
  const prevWeek = weeks.find((w) => w.weekStart === prevMonday);
  if (!prevWeek) return [];

  const { latest, objectiveOrder } = collectWeekItemStates(prevWeek);
  const lines: string[] = [];
  const used = new Set<string>();

  for (const key of objectiveOrder) {
    const state = latest.get(key);
    if (state && isOpenCheckbox(state.checkbox)) {
      lines.push(toCarriedOverLine(state.item));
      used.add(key);
    }
  }

  for (const [key, state] of latest) {
    if (used.has(key)) continue;
    if (isOpenCheckbox(state.checkbox)) {
      lines.push(toCarriedOverLine(state.item));
    }
  }

  return lines;
}

/** Seed a new week's objectives: unfinished items from last week, then today's active work. */
export function buildWeekObjectives(
  content: string,
  monday: string,
  activeLines: string[],
): string[] {
  const carried = computeWeeklyCarryOverLines(content, monday);
  const merged = [...carried];
  const seen = new Set(
    carried
      .map((line) => parseItem(line))
      .filter((item): item is JournalItem => item !== null)
      .map(itemDedupKey),
  );

  for (const line of activeLines) {
    const item = parseItem(line);
    const key = item ? itemDedupKey(item) : line;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }

  return merged;
}
