import { expect, test } from "bun:test";
import { mergeManualExhibitors } from "../scripts/lib/manual-exhibitors.ts";
import type { CanonicalExhibitor, EventConfig } from "../scripts/types.ts";

const event: EventConfig = {
  id: "test", name: "Test", series: { id: "test", name: "Test" }, edition: 1,
  days: [{ id: "2026-10-31", label: "Saturday" }], sourceAttendanceMap: {},
};
const exhibitor: CanonicalExhibitor = {
  id: "1000001", name: "Food booth", spaces: [{ code: "FOOD-01", type: "food" }],
  attendanceDates: ["2026-10-31"], contentRating: null, fandomIds: [], offerings: [],
  assets: { thumbnail: null, gallery: [] }, links: [],
};
const merge = (additions: unknown = [exhibitor], overrides: unknown = [], upstream: CanonicalExhibitor[] = []) =>
  mergeManualExhibitors({ exhibitors: upstream, additions, overrides, event, fandomIds: new Set([34]),
    publicBaseUrl: "https://cf23-config.nnt.gg/", publicDirectory: "public" });

test("manual exhibitors use normal catalog records and explicitly have no catalog page", async () => {
  expect(await merge()).toEqual([{ catalogUrl: null, ...exhibitor }]);
  const upstream = { ...exhibitor, id: "123", name: "Upstream" };
  const [patched, added] = await merge([exhibitor], [{ id: "123", name: "Corrected", fandomIds: [34] }], [upstream]);
  expect(patched).toEqual({ ...upstream, name: "Corrected", fandomIds: [34] });
  expect(added?.id).toBe(exhibitor.id);
  expect(upstream.name).toBe("Upstream");
});

test("overrides replace arrays and nullable values without changing omitted fields", async () => {
  const assets = { thumbnail: "https://example.com/logo.webp", gallery: [] };
  const [result] = await merge([{ ...exhibitor, assets, catalogUrl: "https://example.com/booth" }], [
    { id: exhibitor.id, assets: { thumbnail: null, gallery: [] }, catalogUrl: null, spaces: [{ code: "FOOD-02", type: null }] },
  ]);
  expect(result?.assets.thumbnail).toBeNull();
  expect(result?.catalogUrl).toBeNull();
  expect(result?.spaces).toEqual([{ code: "FOOD-02", type: null }]);
  expect(result?.name).toBe(exhibitor.name);
});

test("rejects duplicate additions, missing targets, repeated patches, and invalid fields", async () => {
  await expect(merge([exhibitor, exhibitor])).rejects.toThrow("already exists");
  await expect(merge([exhibitor], [], [exhibitor])).rejects.toThrow("already exists");
  await expect(merge([], [{ id: "123", name: "Missing" }])).rejects.toThrow("target not found");
  await expect(merge([exhibitor], [{ id: exhibitor.id }, { id: exhibitor.id }])).rejects.toThrow("duplicate override");
  await expect(merge([{ ...exhibitor, id: "12" }])).rejects.toThrow("manual IDs");
  await expect(merge([{ ...exhibitor, id: "manual-food" }])).rejects.toThrow("integer strings");
  await expect(merge([{ ...exhibitor, attendanceDates: ["2099-01-01"] }])).rejects.toThrow("attendanceDates");
  await expect(merge([{ ...exhibitor, fandomIds: [999] }])).rejects.toThrow("fandom IDs");
  await expect(merge([{ ...exhibitor, typo: true }])).rejects.toThrow("unknown field");
  await expect(merge([{ ...exhibitor, assets: {} }])).rejects.toThrow("invalid assets");
});

test("preserves absolute image URLs and rejects invalid or missing local images", async () => {
  const assets = { thumbnail: "https://example.com/logo.webp", gallery: ["https://example.com/photo.webp"] };
  expect((await merge([{ ...exhibitor, assets }]))[0]?.assets).toEqual(assets);
  for (const thumbnail of ["../secret.webp", "/images/logo.webp", "images/../logo.webp", "images/%2e%2e/logo.webp", "data:image/png;base64,abc"]) {
    await expect(merge([{ ...exhibitor, assets: { thumbnail, gallery: [] } }])).rejects.toThrow("invalid image path");
  }
  await expect(merge([{ ...exhibitor, assets: { thumbnail: "images/missing.webp", gallery: [] } }])).rejects.toThrow();
});
