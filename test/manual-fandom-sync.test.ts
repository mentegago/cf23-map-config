import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("manual fandoms submit unknown names, retry failures, and pick up later directory matches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cf23-manual-fandoms-"));
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Invalid fixture root");
  const save = async (file: string, value: unknown) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), JSON.stringify(value));
  };
  const json = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  try {
    await save("config/creator-icons.json", { size: 80, quality: 75, crop: { centerX: 0.5, centerY: 0.55, shortSideScale: 0.9 } });
    const known = { id: 10, name: "Known", kind: "franchise", parentId: null, aliases: [], alternateNames: [] };
    const registry = { fandoms: [known], ignored: [] };
    await save("config/event.json", { id: "test", name: "Test", series: { id: "test", name: "Test" },
      edition: 1, days: [], sourceAttendanceMap: {} });
    await save("data/raw/catalog.json", { schemaVersion: 1, source: "https://catalog.comifuro.net",
      downloadedAt: "2026-10-19T00:00:00.000Z", recordCount: 0, circles: [] });
    await save("data/manual/exhibitors.json", [{ id: "1000001", name: "Manual exhibitor",
      spaces: [{ code: "1108", type: "corporate" }], attendanceDates: [], contentRating: null,
      fandoms: ["Known", "New Fandom"], offerings: [], assets: { thumbnail: null, gallery: [] }, links: [] }]);
    await save("data/manual/overrides.json", []);
    await save("data/manual/id-mappings.json", []);
    await save("data/raw/fandom-directory.json", registry);
    await save("data/raw/fandom-directory.meta.json", {});
    await save("registry-response.json", registry);
    await save("submission-status.json", 503);
    const preload = path.join(root, "fetch.ts");
    await writeFile(preload, `import { appendFile, readFile } from "node:fs/promises";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  await appendFile("requests.jsonl", JSON.stringify({url, body: init?.body}) + "\\n");
  if (url === "https://fandom.directory/api/fandoms.json") return Response.json(JSON.parse(await readFile("registry-response.json", "utf8")));
  if (url === "https://fandom.directory/api/v1/submit") return Response.json({accepted: true}, {status: JSON.parse(await readFile("submission-status.json", "utf8"))});
  throw new Error("Unexpected external request: " + url);
};`);
    const build = async () => {
      const child = Bun.spawn([Bun.argv[0]!, "--preload", preload, path.resolve(import.meta.dir, "../scripts/remap.ts")], {
        cwd: root, env: { ...Bun.env, PUBLIC_BASE_URL: "https://cf23-config.nnt.gg/",
          REFRESH_FANDOMS: "true", FANDOM_DIRECTORY_API_KEY: "test-only-key" },
        stdout: "ignore", stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code, stderr).toBe(0);
    };
    await build();
    expect((await json("public/v1/catalog.json")).exhibitors[0].fandomIds).toEqual([10]);
    expect((await json("data/raw/fandom-submissions.json")).submittedSourceFields).toEqual([]);
    expect((await json("data/unmapped-fandoms.json")).unknownSourceFields).toEqual(["New Fandom"]);
    const before = await json("public/last-updated.json");
    await save("submission-status.json", 200);
    await build();
    expect((await json("data/raw/fandom-submissions.json")).submittedSourceFields).toEqual(["New Fandom"]);
    await build();
    expect(await json("public/last-updated.json")).toEqual(before);
    await save("registry-response.json", { fandoms: [known,
      { ...known, id: 20, name: "New Fandom" }], ignored: [] });
    await build();
    const output = (await json("public/v1/catalog.json")).exhibitors[0];
    expect(output.id).toBe("1000001");
    expect(output.fandomIds).toEqual([10, 20]);
    expect(output.fandoms).toBeUndefined();
    expect((await json("public/last-updated.json")).creator_data_version).toBe(before.creator_data_version + 1);
    expect((await json("data/unmapped-fandoms.json")).unknownSourceFields).toEqual([]);
    expect((await json("data/manual/exhibitors.json"))[0].fandoms).toEqual(["Known", "New Fandom"]);
    expect((await json("data/raw/catalog.json")).circles).toEqual([]);
    const requests = (await readFile(path.join(root, "requests.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(requests.filter(r => r.url.endsWith("/submit")).map(r => JSON.parse(r.body)))
      .toEqual([{ items: ["New Fandom"] }, { items: ["New Fandom"] }]);
    expect(requests.every(r => r.url.startsWith("https://fandom.directory/"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
