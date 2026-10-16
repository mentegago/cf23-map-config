import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const build = async () => {
      const result = Bun.spawn([process.execPath, "--preload", preload, path.join(root, "scripts/remap.ts")], {
        cwd: fixture,
        env: { ...process.env, FANDOM_DIRECTORY_API_KEY: "" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([result.exited, new Response(result.stderr).text()]);
      expect(code, stderr).toBe(0);
    };

    const initial = await json("public/last-updated.json");
    await build();
    expect(await json("public/last-updated.json")).toEqual(initial);
    const initialPublication = await readFile(path.join(fixture, "data/raw/publication.json"), "utf8");
    await build();
    expect(await readFile(path.join(fixture, "data/raw/publication.json"), "utf8")).toBe(initialPublication);

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
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
