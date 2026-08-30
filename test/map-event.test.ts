import { expect, test } from "bun:test";
import { mapEventCatalog } from "../scripts/lib/map-event.ts";
import type { EventConfig, EventSourceAdapter } from "../scripts/types.ts";

const event: EventConfig = {
  id: "example-event",
  name: "Example Event",
  series: { id: "example", name: "Example" },
  edition: 1,
  days: [{ id: "day-1", label: "Day 1" }],
  sourceAttendanceMap: {},
};

test("event mapper is source-agnostic and submits complete original fields", () => {
  const adapter: EventSourceAdapter<{ fandomText: string }> = {
    toCanonicalInput(record) {
      return {
        id: "vendor-1",
        name: "Vendor",
        spaces: [],
        attendanceDayIds: [],
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
