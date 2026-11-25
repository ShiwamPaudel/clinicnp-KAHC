/**
 * lab-notes.ts — one optional note per box of the report (owner, 2083-08-09).
 *
 * The report draws a box per profile, and one per department for its tests
 * billed on their own. Result entry asks for one note per such box, not per
 * test, and the report prints it after the box's last test row.
 *
 * The note is kept as the technician's note (`technician_remarks`) of one test
 * of the box, so it is saved, locked, approved and versioned with that test:
 * the test that already holds a note, else the last test that can still be
 * saved. Pure: Result entry and the tests share it.
 */

/** What a box needs to know about each of its results. */
export interface NoteResult {
  id: string;
  departmentName: string;
  groupName: string;
  status: string;
  sampleStatus: string | null;
  technicianRemarks: string;
}

/** Results that can no longer be changed in Result entry. */
export const LOCKED_RESULT = ["approved", "dispatched", "sent_out"];

export interface NoteGroup<R extends NoteResult = NoteResult> {
  key: string;
  /** the profile's name, or the department's for its tests billed on their own */
  label: string;
  results: R[];
  /** the result whose note is the box's note; null when none can hold one */
  holderId: string | null;
  /** the holder is approved, sent out or waiting for its sample: its note shows but cannot change */
  holderLocked: boolean;
}

const canSave = (r: NoteResult) => !LOCKED_RESULT.includes(r.status) && (!r.sampleStatus || r.sampleStatus === "collected");

/** The boxes in the order they first appear, each with the test holding its note. */
export function noteGroups<R extends NoteResult>(results: R[]): NoteGroup<R>[] {
  const groups: NoteGroup<R>[] = [];
  for (const r of results) {
    const key = `${r.departmentName}|${r.groupName}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: r.groupName || r.departmentName || "Tests", results: [], holderId: null, holderLocked: false }));
    g.results.push(r);
  }
  for (const g of groups) {
    const withNote = g.results.find((r) => r.technicianRemarks.trim() !== "");
    const savable = [...g.results].reverse().find(canSave);
    const holder = withNote ?? savable ?? null;
    g.holderId = holder?.id ?? null;
    g.holderLocked = holder ? !canSave(holder) : false;
  }
  return groups;
}
