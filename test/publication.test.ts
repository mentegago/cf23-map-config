import { expect, test } from "bun:test";
import { nextCreatorDataVersion } from "../scripts/lib/publication.ts";

test("keeps creator data version for an unchanged semantic payload", () => {
  expect(nextCreatorDataVersion({
    previousFingerprint: "same",
    nextFingerprint: "same",
    previousVersion: 22,
  })).toBe(22);
});

test("increments creator data version exactly once for changed semantic data", () => {
  expect(nextCreatorDataVersion({
    previousFingerprint: "old",
    nextFingerprint: "new",
    previousVersion: 22,
  })).toBe(23);
});

test("seeds a newly tracked payload without incrementing", () => {
  expect(nextCreatorDataVersion({
    nextFingerprint: "initial",
    previousVersion: 22,
  })).toBe(22);
});
