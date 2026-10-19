import { expect, test } from "bun:test";
import { mapEventCatalog } from "../scripts/lib/map-event.ts";
import type { CanonicalExhibitorInput, EventConfig, EventSourceAdapter } from "../scripts/types.ts";

const event: EventConfig = {
  id: "example-event",
  name: "Example Event",
  series: { id: "example", name: "Example" },
  edition: 1,
  days: [{ id: "2026-10-31", label: "Saturday" }],
  sourceAttendanceMap: {},
};

test("event mapper is source-agnostic and submits complete original fields", () => {
  const adapter: EventSourceAdapter<{ fandomText: string }> = {
    toCanonicalInput(record) {
      return {
        id: "vendor-1",
        name: "Vendor",
        spaces: [],
        attendanceDates: [],
        contentRating: null,
        fandomSourceFields: [record.fandomText],
        offerings: [],
        assets: { thumbnail: null, gallery: [] },
        links: [],
      };
    },
  };

  const result = mapEventCatalog({
    records: [{ fandomText: "Known, New (A, B)" }],
    event,
    adapter,
    registry: {
      fandoms: [{ id: 10, name: "Known", kind: "franchise", parentId: null, aliases: ["Known"], alternateNames: [] }],
      ignored: [],
    },
  });

  expect(result.exhibitors[0]?.fandomIds).toEqual([10]);
  expect(result.unknownSourceFields).toEqual(["Known, New (A, B)"]);
  expect(result.stats.unknownPieces).toBe(1);
});

test("source posts become labeled links without duplicating evidence or existing creator links", () => {
  const website = { type: "website", url: "https://example.com/creator" };
  const firstPost = "https://discord.com/channels/1/2/3";
  const secondPost = "https://discord.com/channels/1/2/4";
  const records: CanonicalExhibitorInput[] = [
    [firstPost],
    [website.url, firstPost, firstPost, secondPost],
    [],
  ].map((sourceUrls, index) => ({
    id: String(index + 1), name: "Vendor", spaces: [], attendanceDates: [],
    contentRating: null, fandomSourceFields: [], offerings: [],
    assets: { thumbnail: null, gallery: [] }, links: [website], sourceUrls,
  }));
  const result = mapEventCatalog({
    records, event, registry: { fandoms: [], ignored: [] },
    adapter: { toCanonicalInput: record => record },
  });

  expect(result.exhibitors[0]!.links).toEqual([
    website, { type: "source_post", url: firstPost },
  ]);
  expect(result.exhibitors[1]!.links).toEqual([
    website,
    { type: "source_post_1", url: firstPost },
    { type: "source_post_2", url: secondPost },
  ]);
  expect(result.exhibitors[2]!.links).toEqual([website]);
  expect(result.exhibitors[1]!.sourceUrls).toEqual(records[1]!.sourceUrls);
  expect(records[0]!.links).toEqual([website]);
});
