import { expect, test } from "bun:test";
import { preserveUnchangedSnapshot } from "../scripts/lib/catalog-snapshot.ts";
import type { CatalogSnapshot, RawCircle } from "../scripts/types.ts";

const previous: CatalogSnapshot = {
  schemaVersion: 1,
  source: "https://catalog.comifuro.net",
  downloadedAt: "2026-09-04T20:50:02.440Z",
  recordCount: 1,
  circles: [{ id: 1, name: "Circle" } as RawCircle],
};

test("preserves the snapshot and timestamp for identical catalog content", () => {
  const next = {
    ...previous,
    downloadedAt: "2026-10-16T00:00:00.000Z",
    circles: [{ name: "Circle", id: 1 } as RawCircle],
  };
  expect(preserveUnchangedSnapshot(previous, next)).toBe(previous);
});

test("replaces the snapshot when catalog content changes", () => {
  const next = {
    ...previous,
    downloadedAt: "2026-10-16T00:00:00.000Z",
    circles: [{ id: 1, name: "Updated circle" } as RawCircle],
  };
  expect(preserveUnchangedSnapshot(previous, next)).toBe(next);
});

test("creates an initial snapshot", () => {
  expect(preserveUnchangedSnapshot(undefined, previous)).toBe(previous);
});
