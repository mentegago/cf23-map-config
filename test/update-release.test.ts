import { expect, test } from "bun:test";
import { updateRelease } from "../scripts/update-release.ts";

const previous = {
  current_version: 7,
  release_notes: "Previous notes",
  creator_data_version: 58,
  lastUpdated: "2026-10-16T11:38:43.912Z",
  custom: "preserved",
};

test("empty or omitted release inputs preserve all values", () => {
  expect(updateRelease(previous, {})).toEqual(previous);
  expect(updateRelease(previous, { currentVersion: "", releaseNotes: "" })).toEqual(previous);
  expect(updateRelease(previous, { currentVersion: "  ", releaseNotes: "  " })).toEqual(previous);
});

test("updates only the app version when notes are blank", () => {
  expect(updateRelease(previous, { currentVersion: "8", releaseNotes: "" }))
    .toEqual({ ...previous, current_version: 8 });
});

test("updates only the release notes when version is blank", () => {
  const notes = 'New "notes" with $HOME, `code`, and $(echo literal)\nSecond line';
  expect(updateRelease(previous, { currentVersion: "", releaseNotes: notes }))
    .toEqual({ ...previous, release_notes: notes });
});

test("updates both fields without touching data version, timestamp, or other fields", () => {
  expect(updateRelease(previous, { currentVersion: " 8 ", releaseNotes: "New notes" }))
    .toEqual({ ...previous, current_version: 8, release_notes: "New notes" });
  expect(previous.current_version).toBe(7);
});

test("accepts zero and unchanged values", () => {
  expect(updateRelease(previous, { currentVersion: "0" }).current_version).toBe(0);
  expect(updateRelease(previous, { currentVersion: "7", releaseNotes: previous.release_notes }))
    .toEqual(previous);
});

test("rejects invalid app versions before changing release metadata", () => {
  for (const currentVersion of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) {
    expect(() => updateRelease(previous, { currentVersion, releaseNotes: "New notes" }))
      .toThrow("current_version must be a non-negative safe integer");
  }
});
