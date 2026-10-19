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
    // Exercise the real build without network requests or submissions.
    const preload = path.join(fixture, "offline.ts");
    await writeFile(preload, 'globalThis.fetch = async () => new Response(null, { status: 304 });\n');
    const build = async (publicBaseUrl = "https://cf23-config.nnt.gg/", expectedCode = 0) => {
      const result = Bun.spawn([process.execPath, "--preload", preload, path.join(root, "scripts/remap.ts")], {
        cwd: fixture,
        env: { ...process.env, FANDOM_DIRECTORY_API_KEY: "", PUBLIC_BASE_URL: publicBaseUrl },
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
      attendanceDates: [], contentRating: null, fandomIds: [], offerings: [],
      assets: { thumbnail: "images/test/logo.webp", gallery: ["images/test/logo.webp"] },
      links: [], sourceUrls: ["https://example.com/announcement"],
    };
    await save("data/manual/exhibitors.json", [manual]);
    await save("data/manual/overrides.json", [{ id: String(catalog.circles[0].id), name: "Manual correction" }]);
    await build();
    const merged = await json("public/v1/catalog.json");
    expect(merged.stats.exhibitors).toBe(catalog.circles.length + 1);
    expect(merged.exhibitors[0].name).toBe("Manual correction");
    expect(merged.exhibitors.at(-1)).toEqual({ ...manual, catalogUrl: null,
      assets: { thumbnail: "https://cf23-config.nnt.gg/images/test/logo.webp",
        gallery: ["https://cf23-config.nnt.gg/images/test/logo.webp"] } });
    const manualVersion = await json("public/last-updated.json");
    expect(manualVersion.creator_data_version).toBe(changed.creator_data_version + 1);
    await build();
    expect(await json("public/last-updated.json")).toEqual(manualVersion);
    manual.name = "Renamed Food";
    await save("data/manual/exhibitors.json", [manual]);
    await build();
    expect((await json("public/last-updated.json")).creator_data_version).toBe(manualVersion.creator_data_version + 1);

    await build("https://events.example.com/catalog/");
    expect((await json("public/v1/catalog.json")).exhibitors.at(-1).assets.thumbnail)
      .toBe("https://events.example.com/catalog/images/test/logo.webp");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
