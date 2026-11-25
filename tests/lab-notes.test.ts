import { describe, it, expect } from "vitest";
import { noteGroups, type NoteResult } from "@/lib/lab-notes";

let n = 0;
const r = (groupName: string, o: Partial<NoteResult> = {}): NoteResult => ({
  id: `r${++n}`, departmentName: "Biochemistry", groupName, status: "pending", sampleStatus: "collected", technicianRemarks: "", ...o,
});

describe("one note per box of the report", () => {
  it("groups by profile, and a department's own tests together, in the order they come", () => {
    const list = [r("LFT"), r("LFT"), r(""), r("Lipid"), r(""), r("", { departmentName: "Hematology" })];
    const g = noteGroups(list);
    expect(g.map((x) => [x.label, x.results.length])).toEqual([
      ["LFT", 2], ["Biochemistry", 2], ["Lipid", 1], ["Hematology", 1],
    ]);
  });

  it("keeps the note on the box's last test that can be saved", () => {
    const a = r("CBC"), b = r("CBC"), c = r("CBC", { status: "sent_out" }), d = r("CBC", { sampleStatus: "pending" });
    const [g] = noteGroups([a, b, c, d]);
    expect(g!.holderId).toBe(b.id);
    expect(g!.holderLocked).toBe(false);
  });

  it("stays with the test that already holds it, locked once that test is approved", () => {
    const a = r("TFT", { technicianRemarks: "Haemolysed.", status: "approved" }), b = r("TFT");
    const [g] = noteGroups([a, b]);
    expect(g!.holderId).toBe(a.id);
    expect(g!.holderLocked).toBe(true);
  });

  it("has no note when nothing in the box can hold one", () => {
    const [g] = noteGroups([r("Serology", { status: "sent_out" })]);
    expect(g!.holderId).toBeNull();
  });
});
