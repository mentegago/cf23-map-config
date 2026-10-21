import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadManualExhibitors, mergeManualExhibitors } from "../scripts/lib/manual-exhibitors.ts";
import type { CanonicalExhibitorInput, EventConfig, ManualExhibitorInput } from "../scripts/types.ts";

const event: EventConfig = { id: "test", name: "Test", series: { id: "test", name: "Test" }, edition: 1,
  days: [{ id: "2026-10-31", label: "SAT" }, { id: "2026-11-01", label: "SUN" }], sourceAttendanceMap: {} };
const registry = { fandoms: [{ id: 10, name: "Manual fandom", kind: "franchise", parentId: null, aliases: [], alternateNames: [] },
  { id: 20, name: "Official fandom", kind: "franchise", parentId: null, aliases: [], alternateNames: [] }], ignored: [] };
const manual: ManualExhibitorInput = { id: "1000001", name: "Manual name", spaces: [{ code: "A-01a", type: null }, { code: "A-01b", type: null }],
  attendanceDates: ["2026-10-31"], contentRating: "manual rating", fandoms: ["Manual fandom"], offerings: ["comic"],
  assets: { thumbnail: "https://example.com/manual-cut.webp", gallery: ["https://example.com/manual-catalog.webp"] },
  links: [{ type: "twitter", url: "https://x.com/manual" }], sourceUrls: ["https://example.com/manual-post"] };
const official: CanonicalExhibitorInput = { id: "123", name: "Official name", spaces: [{ code: "A-01ab", type: "circle" }],
  attendanceDates: ["2026-10-31"], contentRating: "official rating", fandomSourceFields: ["Official fandom"], offerings: ["goods"],
  catalogUrl: "https://catalog.comifuro.net/circle/123", assets: { thumbnail: null, gallery: [] },
  links: [{ type: "twitter", url: "https://x.com/official" }] };
const run = (exhibitors = [official], additions = [manual], idMappings: unknown = [], overrides: unknown = []) =>
  mergeManualExhibitors({ exhibitors, additions, idMappings, overrides, event, registry,
    publicBaseUrl: "https://cf23-config.nnt.gg/", publicDirectory: "public" });

test("without an official catalog, manual content survives and official structural fields always win", async () => {
  const current = { ...official, spaces: [{ code: "B-02", type: "circle" }], attendanceDates: ["2026-11-01"] };
  const result = await run([current], [manual], [{ officialId: "123", manualId: manual.id }], [
    { id: manual.id, name: "Manual correction", offerings: ["music"], spaces: [{ code: "BAD", type: null }] },
  ]);
  const e = result.exhibitors[0]!;
  expect(e.id).toBe(manual.id);
  expect(e.name).toBe("Manual correction");
  expect(e.assets).toEqual({ thumbnail: null, gallery: manual.assets.gallery });
  expect(e.spaces).toEqual(current.spaces);
  expect(e.attendanceDates).toEqual(current.attendanceDates);
  expect(e.offerings).toEqual(current.offerings);
  expect(e.catalogUrl).toBe(current.catalogUrl);
  expect(e.contentRating).toBe(manual.contentRating);
  expect(e.fandomIds).toEqual([10]);
  expect(e.sourceUrls).toEqual(manual.sourceUrls);
  expect(e.links[0]).toEqual(manual.links[0]);
});

test("an official catalog switches content to official data, and its removal restores manual content", async () => {
  const withCatalog = { ...official, assets: { thumbnail: "https://example.com/official-cut.webp", gallery: ["https://example.com/official-catalog.webp"] } };
  const published = (await run([withCatalog])).exhibitors[0]!;
  expect(published.id).toBe(manual.id);
  expect(published.name).toBe(official.name);
  expect(published.assets).toEqual(withCatalog.assets);
  expect(published.fandomIds).toEqual([20]);
  expect(published.links).toEqual(official.links);
  expect(published.sourceUrls).toBeUndefined();
  const reverted = (await run()).exhibitors[0]!;
  expect(reverted.id).toBe(published.id);
  expect(reverted.name).toBe(manual.name);
  expect(reverted.assets.gallery).toEqual(manual.assets.gallery);
});

test("without a manual catalog, all content comes from official data while the manual ID stays stable", async () => {
  const withoutCatalog = { ...manual, assets: { ...manual.assets, gallery: [] } };
  for (const current of [official, { ...official, assets: { ...official.assets, gallery: ["https://example.com/official-catalog.webp"] } }]) {
    const published = (await run([current], [withoutCatalog], [{ officialId: official.id, manualId: manual.id }],
      [{ id: manual.id, name: "Manual correction", fandoms: ["Unknown manual fandom"] }])).exhibitors[0]!;
    const { fandomSourceFields, ...officialFields } = current;
    expect(published).toEqual({ ...officialFields, id: manual.id, fandomIds: [20] });
    expect(published).not.toHaveProperty("fandomSourceFields");
    expect(published).not.toHaveProperty("sourceUrls");
  }
  const corporate = { ...withoutCatalog, category: "corporate", spaces: [{ code: "1106", type: null }] };
  const unmatched = (await run([], [corporate])).exhibitors[0]!;
  expect(unmatched.name).toBe(corporate.name);
  expect(unmatched.fandomIds).toEqual([10]);
});

test("fallback requires every booth code and attendance day, and never matches numeric corporate booths", async () => {
  const sunday = { ...manual, id: "1000002", name: "Sunday", attendanceDates: ["2026-11-01"] };
  const matched = await run([official], [sunday, manual]);
  expect(matched.exhibitors.map(x => x.id)).toEqual([manual.id, sunday.id]);
  expect(matched.idMappings).toEqual([{ officialId: official.id, manualId: manual.id }]);
  for (const changed of [
    { ...official, attendanceDates: ["2026-10-31", "2026-11-01"] },
    { ...official, spaces: [{ code: "A-01a", type: null }] },
    { ...official, spaces: [{ code: "A-01ab/A-02ab", type: null }] },
  ]) expect((await run([changed])).exhibitors).toHaveLength(2);
  const corporate = { ...manual, spaces: [{ code: "1307", type: "corporate" }] };
  expect((await run([{ ...official, spaces: corporate.spaces }], [corporate])).exhibitors).toHaveLength(2);
});

test("explicit mappings reserve their targets; ambiguous fallback claims stop the refresh", async () => {
  const duplicate = { ...manual, id: "1000002" };
  await expect(run([official], [manual, duplicate])).rejects.toThrow("ambiguous");
  await expect(run([official, { ...official, id: "456" }])).rejects.toThrow("multiple official exhibitors");
  expect((await run([official], [manual], [{ officialId: "999", manualId: manual.id }])).exhibitors).toHaveLength(2);
  expect((await run([{ ...official, spaces: [{ code: "B-02", type: null }] }], [manual],
    [{ officialId: official.id, manualId: manual.id }])).exhibitors[0]?.id).toBe(manual.id);
});

test("new official booths and fallback matches persist manual identities across later moves", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cf23-identities-"));
  const priorBase = process.env.PUBLIC_BASE_URL;
  const save = async (file: string, value: unknown) => writeFile(path.join(root, file), JSON.stringify(value));
  try {
    await mkdir(path.join(root, "data/manual"), { recursive: true });
    await save("data/manual/exhibitors.json", [manual]);
    await save("data/manual/id-mappings.json", []);
    await save("data/manual/overrides.json", []);
    process.env.PUBLIC_BASE_URL = "https://cf23-config.nnt.gg/";
    const newcomer = { ...official, id: "456", name: "New booth", spaces: [{ code: "C-03", type: null }] };
    const first = await loadManualExhibitors(root, [official, newcomer], event, registry);
    expect(first.exhibitors.map(e => e.id)).toEqual([manual.id, "1000002"]);
    const mappingText = await readFile(path.join(root, "data/manual/id-mappings.json"), "utf8");
    expect(JSON.parse(mappingText)).toEqual([{ officialId: "123", manualId: manual.id }, { officialId: "456", manualId: "1000002" }]);
    const second = await loadManualExhibitors(root, [{ ...official, spaces: [{ code: "D-04", type: null }] }, newcomer], event, registry);
    expect(second.exhibitors.map(e => e.id)).toEqual(first.exhibitors.map(e => e.id));
    expect(await readFile(path.join(root, "data/manual/id-mappings.json"), "utf8")).toBe(mappingText);
  } finally {
    if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = priorBase;
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Invalid fixture root");
    await rm(root, { recursive: true, force: true });
  }
});
