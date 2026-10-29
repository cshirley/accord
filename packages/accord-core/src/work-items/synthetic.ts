/**
 * Synthetic work item IDs for ad-hoc work that has no tracker ticket.
 *
 * Format: `ADHOC-<YYYYMMDD><NN>` (NN = 01..99, per day). It matches
 * `DEV_WORK_ITEM_ID_PATTERN` (`^[A-Z]+(?:-[A-Z]+)*-\d+$`) and `WORK_ITEM_FILE_PATTERN`, which a
 * hyphenated counter suffix would not. These IDs are never tracker tickets, so gather must not
 * look them up.
 */

export const SYNTHETIC_ID_PREFIX = "ADHOC-";

const SYNTHETIC_ID_PATTERN = /^ADHOC-\d{10}$/;

export function isSyntheticWorkItemId(id: string): boolean {
  return SYNTHETIC_ID_PATTERN.test(id.trim());
}

function dateStamp(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Next free synthetic ID for `now`'s local date.
 *
 * @param exists - true when the ID is already taken (work item JSON or `docs/dev/<ID>/`).
 * @throws when all 99 slots for the day are taken.
 */
export function nextSyntheticWorkItemId(
  exists: (candidate: string) => boolean,
  now: Date = new Date(),
): string {
  const stamp = dateStamp(now);
  for (let sequence = 1; sequence <= 99; sequence++) {
    const candidate = `${SYNTHETIC_ID_PREFIX}${stamp}${String(sequence).padStart(2, "0")}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`No free ${SYNTHETIC_ID_PREFIX}${stamp}NN id left for today`);
}
