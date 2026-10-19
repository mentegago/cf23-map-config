import { expect, test } from "bun:test";
import { mergeManualExhibitors } from "../scripts/lib/manual-exhibitors.ts";
import type { CanonicalExhibitorInput, EventConfig, ManualExhibitorInput } from "../scripts/types.ts";

const event: EventConfig = {
  id: "test", name: "Test", series: { id: "test", name: "Test" }, edition: 1,
  days: [{ id: "2026-10-31", label: "Saturday" }], sourceAttendanceMap: {},
};
const exhibitor: ManualExhibitorInput = {
  id: "1000001", name: "Food booth", spaces: [{ code: "FOOD-01", type: "food" }],
  attendanceDates: ["2026-10-31"], contentRating: null, fandoms: [], offerings: [],
  assets: { thumbnail: null, gallery: [] }, links: [],
};
const registry = { fandoms: [{ id: 34, name: "Known", kind: "franchise", parentId: null,
  aliases: ["Known", "Alias"], alternateNames: [] }], ignored: ["Original"] };
const processManual = (additions: unknown = [exhibitor], overrides: unknown = [], upstream: CanonicalExhibitorInput[] = [], idMappings: unknown = []) =>
  mergeManualExhibitors({ exhibitors: upstream, additions, overrides, event, registry, idMappings,
    publicBaseUrl: "https://cf23-config.nnt.gg/", publicDirectory: "public" });
const merge = async (additions: unknown = [exhibitor], overrides: unknown = [], upstream: CanonicalExhibitorInput[] = []) =>
  (await processManual(additions, overrides, upstream)).exhibitors;
const { fandoms: _rawFandoms, ...exhibitorFields } = exhibitor;
const publicExhibitor = { ...exhibitorFields, fandomIds: [] };

test("manual exhibitors use normal catalog records and explicitly have no catalog page", async () => {
  expect(await merge()).toEqual([{ catalogUrl: null, ...publicExhibitor }]);
  const upstream = { ...exhibitorFields, id: "123", name: "Upstream", fandomSourceFields: [] };
  const [patched, added] = await merge([exhibitor], [{ id: "123", name: "Corrected", fandoms: ["Known"] }], [upstream]);
  expect(patched).toEqual({ ...exhibitorFields, id: "123", name: "Corrected", fandomIds: [34] });
  expect(added?.id).toBe(exhibitor.id);
  expect(upstream.name).toBe("Upstream");
});

test("ID mappings switch to official data without changing the public ID and retain a manual fallback", async () => {
  const mapping = [{ officialId: "123", manualId: exhibitor.id }];
  const fallback = { ...exhibitor, category: "food", fandoms: ["Unknown manual fandom"] };
  const overrides = [{ id: exhibitor.id, name: "Manual correction", fandoms: ["Another manual fandom"] }];
  const before = await processManual([fallback], overrides, [], mapping);
  expect(before.exhibitors[0]?.id).toBe(exhibitor.id);
  expect(before.exhibitors[0]?.name).toBe("Manual correction");
  const official = { ...exhibitorFields, id: "123", name: "Official name", spaces: [{ code: "1109", type: "corporate" }],
    assets: { thumbnail: "https://example.com/official.webp", gallery: ["https://example.com/catalog.webp"] },
    offerings: ["comic"], fandomSourceFields: ["Known"], catalogUrl: "https://catalog.comifuro.net/circle/123" };
  const current = await processManual([fallback], [...overrides, { id: "123", name: "Stale official override" }], [official], mapping);
  const { fandomSourceFields: _officialFandoms, ...officialFields } = official;
  expect(current.exhibitors).toEqual([{ ...officialFields, id: exhibitor.id, fandomIds: [34] }]);
  expect(current.exhibitors[0]).not.toHaveProperty("category");
  expect(current.unknownSourceFields).toEqual([]);
  expect(official.id).toBe("123");
  const after = await processManual([fallback], overrides, [], mapping);
  expect(after.exhibitors).toEqual(before.exhibitors);
  expect(after.unknownSourceFields).toEqual(before.unknownSourceFields);
});

test("unmapped corporate booths remain intact alongside mapped and unmapped official exhibitors", async () => {
  const corporate = { ...exhibitor, name: "Corporate brand", category: "corporate",
    spaces: [{ code: "1108", type: "corporate" }], fandoms: ["Known"], offerings: ["goods"],
    assets: { thumbnail: "https://example.com/brand.webp", gallery: ["https://example.com/announcement.webp"] },
    links: [{ type: "twitter", url: "https://x.com/example" }], sourceUrls: ["https://example.com/announcement"] };
  const mappedManual = { ...exhibitor, id: "1000002", name: "Manual creator" };
  // Matching names and booth codes must not cause implicit replacement.
  const official = { ...exhibitorFields, id: "123", name: corporate.name,
    spaces: corporate.spaces, fandomSourceFields: [] };
  const unrelated = { ...official, id: "456", name: "Another official creator" };
  const mapping = [{ officialId: "123", manualId: mappedManual.id }];
  const before = await processManual([corporate, mappedManual], [], [], mapping);
  const after = await processManual([corporate, mappedManual], [], [official, unrelated], mapping);
  const { fandoms: _corporateFandoms, ...corporateFields } = corporate;
  const expected = { catalogUrl: null, ...corporateFields, fandomIds: [34],
    links: [...corporate.links, { type: "source_post", url: corporate.sourceUrls[0]! }] };
  expect(before.exhibitors.find(record => record.id === corporate.id)).toEqual(expected);
  expect(after.exhibitors.find(record => record.id === corporate.id)).toEqual(expected);
  expect(after.exhibitors.map(record => record.id)).toEqual([mappedManual.id, unrelated.id, corporate.id]);
  expect(after.exhibitors.find(record => record.id === mappedManual.id)?.name).toBe(official.name);
  expect(after.exhibitors.find(record => record.id === unrelated.id)?.name).toBe(unrelated.name);
});

test("ID mappings reject ambiguous sources, targets, chains, and public ID collisions", async () => {
  const official = { ...exhibitorFields, id: "123", fandomSourceFields: [] };
  const mapping = { officialId: "123", manualId: exhibitor.id };
  await expect(processManual([exhibitor], [], [], [mapping, mapping])).rejects.toThrow("duplicate mapping");
  await expect(processManual([exhibitor], [], [], [mapping, { ...mapping, officialId: "456" }])).rejects.toThrow("multiple official IDs");
  await expect(processManual([exhibitor], [], [], [{ ...mapping, manualId: "1000099" }])).rejects.toThrow("manual ID not found");
  await expect(processManual([exhibitor], [], [], { "123": exhibitor.id })).rejects.toThrow("must be an array");
  await expect(processManual([exhibitor], [], [], null)).rejects.toThrow("must be an array");
  await expect(processManual([exhibitor], [], [], [{ ...mapping, officialId: 123 }])).rejects.toThrow("positive integer strings");
  await expect(processManual([exhibitor], [], [], [{ ...mapping, officialId: exhibitor.id }])).rejects.toThrow("must differ");
  await expect(processManual([exhibitor], [], [], [{ ...mapping, typo: true }])).rejects.toThrow("positive integer strings");
  await expect(processManual([exhibitor, { ...exhibitor, id: "1000002" }], [], [],
    [mapping, { officialId: exhibitor.id, manualId: "1000002" }])).rejects.toThrow("cannot form chains");
  await expect(processManual([exhibitor], [], [official, { ...official, id: exhibitor.id }], [mapping])).rejects.toThrow("collision");
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
  await expect(merge([exhibitor], [], [{ ...exhibitorFields, fandomSourceFields: [] }])).rejects.toThrow("already exists");
  await expect(merge([], [{ id: "123", name: "Missing" }])).rejects.toThrow("target not found");
  await expect(merge([exhibitor], [{ id: exhibitor.id }, { id: exhibitor.id }])).rejects.toThrow("duplicate override");
  await expect(merge([{ ...exhibitor, id: "12" }])).rejects.toThrow("manual IDs");
  await expect(merge([{ ...exhibitor, id: "manual-food" }])).rejects.toThrow("integer strings");
  await expect(merge([{ ...exhibitor, attendanceDates: ["2099-01-01"] }])).rejects.toThrow("attendanceDates");
  await expect(merge([{ ...exhibitor, fandoms: [999] }])).rejects.toThrow("fandoms must");
  await expect(merge([{ ...exhibitor, fandoms: null }])).rejects.toThrow("fandoms must");
  await expect(merge([{ ...exhibitor, fandoms: ["  "] }])).rejects.toThrow("fandoms must");
  await expect(merge([{ ...exhibitor, fandomIds: [34] }])).rejects.toThrow("unknown field fandomIds");
  await expect(merge([{ ...exhibitor, typo: true }])).rejects.toThrow("unknown field");
  await expect(merge([{ ...exhibitor, assets: {} }])).rejects.toThrow("invalid assets");
});

test("manual fandom names resolve aliases and submit only unknown original text", async () => {
  const raw = ["Known", "Alias", "Original", "Known, New (A, B)"];
  const mapped = await processManual([{ ...exhibitor, fandoms: raw }]);
  expect(mapped.exhibitors[0]?.fandomIds).toEqual([34]);
  expect(mapped.unknownSourceFields).toEqual(["Known, New (A, B)"]);
  expect(mapped.stats.ignoredPieces).toBe(1);
  expect(mapped.exhibitors[0]).not.toHaveProperty("fandoms");
  expect(raw).toEqual(["Known", "Alias", "Original", "Known, New (A, B)"]);
});

test("fandom overrides replace upstream text before diagnostics and empty arrays clear IDs", async () => {
  const upstream = { ...exhibitorFields, id: "123", fandomSourceFields: ["Unwanted upstream field"] };
  const mapped = await processManual([], [{ id: "123", fandoms: ["Known"] }], [upstream]);
  expect(mapped.exhibitors[0]?.fandomIds).toEqual([34]);
  expect(mapped.unknownSourceFields).toEqual([]);
  const cleared = await processManual([{ ...exhibitor, fandoms: ["Known"] }], [{ id: exhibitor.id, fandoms: [] }]);
  expect(cleared.exhibitors[0]?.fandomIds).toEqual([]);
});

test("preserves absolute image URLs and rejects invalid or missing local images", async () => {
  const assets = { thumbnail: "https://example.com/logo.webp", gallery: ["https://example.com/photo.webp"] };
  expect((await merge([{ ...exhibitor, assets }]))[0]?.assets).toEqual(assets);
  for (const thumbnail of ["../secret.webp", "/images/logo.webp", "images/../logo.webp", "images/%2e%2e/logo.webp", "data:image/png;base64,abc"]) {
    await expect(merge([{ ...exhibitor, assets: { thumbnail, gallery: [] } }])).rejects.toThrow("invalid image path");
  }
  await expect(merge([{ ...exhibitor, assets: { thumbnail: "images/missing.webp", gallery: [] } }])).rejects.toThrow();
});
