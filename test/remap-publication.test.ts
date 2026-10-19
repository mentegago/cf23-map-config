import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("remap keeps version and timestamp for metadata changes, and advances both once for content changes", async () => {
  const root = path.resolve(import.meta.dir, "..");
  const fixture = await mkdtemp(path.join(tmpdir(), "cf23-publication-"));
  if (!path.resolve(fixture).startsWith(path.resolve(tmpdir()) + path.sep)) {
    throw new Error("Test fixture must stay inside the temporary directory");
  }
  const json = async (file: string) => JSON.parse(await readFile(path.join(fixture, file), "utf8"));
  const save = async (file: string, value: unknown) => writeFile(path.join(fixture, file), JSON.stringify(value));
  try {
    for (const directory of ["config", "data", "public"]) {
      await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    }
    // Do not depend on the maintained official snapshot containing any entries.
    const rawFixture = await json("data/raw/catalog.json");
    rawFixture.circles = [{ id: 123, name: "Fixture creator", circle_code: "A-01",
      circle_type: null, circle_cut: null, day: "Both Days", rating: null,
      fandom: null, other_fandom: null, sampleworks_images: [],
      circle_facebook: null, circle_instagram: null, circle_twitter: null,
      circle_other_socials: null, marketplace_link: null }];
    rawFixture.recordCount = rawFixture.circles.length;
    await save("data/raw/catalog.json", rawFixture);
    // Exercise the real build without network requests or submissions.
    const preload = path.join(fixture, "offline.ts");
    await writeFile(preload, 'import { appendFile } from "node:fs/promises";\n' +
      'globalThis.fetch = async () => { await appendFile("network-requests.txt", "fetch\\n"); return new Response(null, { status: 304 }); };\n');
    const build = async (publicBaseUrl = "https://cf23-config.nnt.gg/", expectedCode = 0, refreshFandoms = "true") => {
      const result = Bun.spawn([process.execPath, "--preload", preload, path.join(root, "scripts/remap.ts")], {
        cwd: fixture,
        env: { ...process.env,
          FANDOM_DIRECTORY_API_KEY: refreshFandoms === "false" ? "test-key-must-not-be-used" : "",
          PUBLIC_BASE_URL: publicBaseUrl, REFRESH_FANDOMS: refreshFandoms },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([result.exited, new Response(result.stderr).text()]);
      expect(code, stderr).toBe(expectedCode);
      return stderr;
    };

    const beforeBuild = await json("public/last-updated.json");
    expect(await build("", 1)).toContain("set PUBLIC_BASE_URL");
    expect(await json("public/last-updated.json")).toEqual(beforeBuild);
    // Maintained manual inputs may be newer than the committed public output.
    // Establish the processed baseline before testing no-op refreshes.
    await build();
    const initial = await json("public/last-updated.json");
    await build();
    expect(await json("public/last-updated.json")).toEqual(initial);
    const initialPublication = await readFile(path.join(fixture, "data/raw/publication.json"), "utf8");
    await build();
    expect(await readFile(path.join(fixture, "data/raw/publication.json"), "utf8")).toBe(initialPublication);

    // Map publications share the manifest but have an independent version and
    // must not conflict with immutable catalog analytics archives.
    const sharedManifest = await json("public/manifest.json");
    const mapDescriptor = {version: 999, path: "maps/independent.json", fingerprint: "map"};
    await save("public/manifest.json", {...sharedManifest, map: mapDescriptor});
    await build();
    expect((await json("public/manifest.json")).map).toEqual(mapDescriptor);
    expect(await json("public/last-updated.json")).toEqual(initial);

    const catalog = await json("data/raw/catalog.json");
    catalog.downloadedAt = "2099-01-01T00:00:00.000Z";
    await save("data/raw/catalog.json", catalog);
    const meta = await json("data/raw/fandom-directory.meta.json");
    meta.etag = '"metadata-only-change"';
    await save("data/raw/fandom-directory.meta.json", meta);
    await build();
    expect(await json("public/last-updated.json")).toEqual(initial);

    catalog.circles[0].name += " updated";
    await save("data/raw/catalog.json", catalog);
    await build();
    const changed = await json("public/last-updated.json");
    expect(changed.creator_data_version).toBe(initial.creator_data_version + 1);
    expect(changed.lastUpdated).not.toBe(initial.lastUpdated);
    expect(changed.current_version).toBe(initial.current_version);
    expect(changed.release_notes).toBe(initial.release_notes);
    await build();
    expect(await json("public/last-updated.json")).toEqual(changed);

    await mkdir(path.join(fixture, "public/images/test"), { recursive: true });
    await writeFile(path.join(fixture, "public/images/test/logo.webp"), "test-image");
    const manual = {
      id: "1000001", name: "Manual Food", spaces: [{ code: "FOOD-01", type: "food" }],
      attendanceDates: [], contentRating: null, fandoms: [], offerings: [],
      assets: { thumbnail: "images/test/logo.webp", gallery: ["images/test/logo.webp"] },
      links: [], sourceUrls: ["https://example.com/announcement"],
    };
    await save("data/manual/exhibitors.json", [manual]);
    await save("data/manual/overrides.json", [{ id: String(catalog.circles[0].id), name: "Manual correction" }]);
    await build();
    const merged = await json("public/v1/catalog.json");
    expect(merged.stats.exhibitors).toBe(catalog.circles.length + 1);
    expect(merged.exhibitors[0].name).toBe("Manual correction");
    const { fandoms: _manualFandoms, ...manualFields } = manual;
    expect(merged.exhibitors.at(-1)).toEqual({ ...manualFields, fandomIds: [], catalogUrl: null,
      links: [{ type: "source_post", url: "https://example.com/announcement" }],
      assets: { thumbnail: "https://cf23-config.nnt.gg/images/test/logo.webp",
        gallery: ["https://cf23-config.nnt.gg/images/test/logo.webp"] } });
    const manualVersion = await json("public/last-updated.json");
    expect(manualVersion.creator_data_version).toBe(changed.creator_data_version + 1);
    await build();
    expect(await json("public/last-updated.json")).toEqual(manualVersion);
    manual.name = "Renamed Food";
    await save("data/manual/exhibitors.json", [manual]);
    // Manual publication must use the cached registry and never submit fields,
    // even when an API key is available. Record every fetch at the boundary.
    const registryBefore = await readFile(path.join(fixture, "data/raw/fandom-directory.json"), "utf8");
    const metaBefore = await readFile(path.join(fixture, "data/raw/fandom-directory.meta.json"), "utf8");
    const submissionsBefore = await readFile(path.join(fixture, "data/raw/fandom-submissions.json"), "utf8");
    await writeFile(path.join(fixture, "network-requests.txt"), "");
    await build("https://cf23-config.nnt.gg/", 0, "false");
    expect(await readFile(path.join(fixture, "network-requests.txt"), "utf8")).toBe("");
    expect(await readFile(path.join(fixture, "data/raw/fandom-directory.json"), "utf8")).toBe(registryBefore);
    expect(await readFile(path.join(fixture, "data/raw/fandom-directory.meta.json"), "utf8")).toBe(metaBefore);
    expect(await readFile(path.join(fixture, "data/raw/fandom-submissions.json"), "utf8")).toBe(submissionsBefore);
    expect((await json("public/v1/catalog.json")).exhibitors.at(-1).name).toBe("Renamed Food");
    expect((await json("public/last-updated.json")).creator_data_version).toBe(manualVersion.creator_data_version + 1);
    const offlineVersion = await json("public/last-updated.json");
    await build("https://cf23-config.nnt.gg/", 0, "false");
    expect(await json("public/last-updated.json")).toEqual(offlineVersion);
    expect(await readFile(path.join(fixture, "network-requests.txt"), "utf8")).toBe("");

    await build("https://events.example.com/catalog/");
    expect((await json("public/v1/catalog.json")).exhibitors.at(-1).assets.thumbnail)
      .toBe("https://events.example.com/catalog/images/test/logo.webp");

    const beforeMapping = await json("public/last-updated.json");
    await save("data/manual/id-mappings.json", [{ officialId: String(catalog.circles[0].id), manualId: manual.id }]);
    await build();
    const mappedCatalog = await json("public/v1/catalog.json");
    expect(mappedCatalog.exhibitors).toHaveLength(1);
    expect(mappedCatalog.exhibitors[0].id).toBe(manual.id);
    expect(mappedCatalog.exhibitors[0].name).toBe(catalog.circles[0].name);
    expect(mappedCatalog.exhibitors[0].spaces).toEqual([{ code: "A-01", type: null }]);
    expect(mappedCatalog.exhibitors[0].assets).toEqual({ thumbnail: null, gallery: [] });
    expect(mappedCatalog.exhibitors[0].catalogUrl).toBe(`https://catalog.comifuro.net/circle/${catalog.circles[0].id}`);
    expect((await json("public/last-updated.json")).creator_data_version).toBe(beforeMapping.creator_data_version + 1);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
