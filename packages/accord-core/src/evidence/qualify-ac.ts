/** Work-item-qualified AC/TC references (`<work_item_id>/AC-<n>`). */

const QUALIFIED_REF = /^[A-Za-z][A-Za-z0-9_-]*\/((?:AC|TC)-\d+)$/;
const BARE_REF = /(?<![A-Za-z0-9_/])(?:AC|TC)-\d+/g;
const TRAILER_AC = /(?<![A-Za-z0-9_])ac=\S*/g;

function qualify(workItemId: string, ref: string): string {
  return QUALIFIED_REF.test(ref) ? ref : `${workItemId}/${ref}`;
}

export function qualifyAcRef(workItemId: string, acId: string): string {
  return qualify(workItemId, acId);
}

export function qualifyTcRef(workItemId: string, tcId: string): string {
  return qualify(workItemId, tcId);
}

/** Bare `AC-<n>` / `TC-<n>` refs, ignoring the `ac=` trailer value (the trailer carries `id=`). */
export function findBareAcRefs(text: string): string[] {
  return text.replace(TRAILER_AC, " ").match(BARE_REF) ?? [];
}

export function normalizeAcId(id: string): string {
  return QUALIFIED_REF.exec(id)?.[1] ?? id;
}
