import { expect, test } from "bun:test";
import { nextCreatorDataVersion, publicationTimestamp } from "../scripts/lib/publication.ts";

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

test("keeps the publication timestamp whenever the version stays the same", () => {
  expect(publicationTimestamp({
    previousVersion: 39,
    nextVersion: 39,
    previousTimestamp: "2026-09-04T20:50:06.519Z",
    now: "2026-10-16T00:00:00.000Z",
  })).toBe("2026-09-04T20:50:06.519Z");
});

test("advances the publication timestamp for a new version", () => {
  expect(publicationTimestamp({
    previousVersion: 39,
    nextVersion: 40,
    previousTimestamp: "2026-09-04T20:50:06.519Z",
    now: "2026-10-16T00:00:00.000Z",
  })).toBe("2026-10-16T00:00:00.000Z");
});

test("initializes the publication timestamp when no previous timestamp exists", () => {
  expect(publicationTimestamp({
    previousVersion: 22,
    nextVersion: 22,
    now: "2026-10-16T00:00:00.000Z",
  })).toBe("2026-10-16T00:00:00.000Z");
});
