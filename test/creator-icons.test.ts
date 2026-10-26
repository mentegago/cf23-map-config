import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateCreatorIcons } from "../scripts/lib/creator-icons.ts";
import type { CanonicalExhibitor } from "../scripts/types.ts";

const creator: CanonicalExhibitor = { id: "1", name: "Test", spaces: [], attendanceDates: [], contentRating: null,
  fandomIds: [], offerings: [], links: [], assets: { thumbnail: "https://images.example/cut.png", gallery: [] } };
test("icons generate once per booth and regenerate only when their file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cf23-icons-"));
  try {
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(path.join(root, "config/creator-icons.json"), JSON.stringify({ size: 80, quality: 75, crop: { centerX: 0.5, centerY: 0.5, shortSideScale: 0.9 } }));
    const source = await sharp({ create: { width: 240, height: 80, channels: 3, background: "red" } })
      .composite([{ input: await sharp({ create: { width: 80, height: 80, channels: 3, background: "blue" } }).png().toBuffer(), left: 80, top: 0 }]).png().toBuffer();
    const request = (async () => new Response(source, { headers: { etag: '"one"' } }));
    const [first] = await generateCreatorIcons(root, [creator], "https://data.example/", request);
    const file = path.join(root, "public", new URL(first!.assets.icon!).pathname);
    const bytes = await readFile(file);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([80, 80, "webp"]);
    const pixel = await sharp(bytes).raw().toBuffer();
    expect(pixel[2]!).toBeGreaterThan(240);
    expect(pixel[0]!).toBeLessThan(15);
    expect(first!.assets.thumbnail).toBe(creator.assets.thumbnail);
    let requests = 0;
    const noRequest = async () => { requests++; throw Error("Unexpected image request"); };
    const cached = await generateCreatorIcons(root, [creator], "https://data.example/", noRequest);
    expect(cached).toEqual([first!]);
    await writeFile(path.join(root, "config/creator-icons.json"), JSON.stringify({ size: 40, quality: 80, crop: { centerX: 0.5, centerY: 0.5, shortSideScale: 1 } }));
    const [changedSource] = await generateCreatorIcons(root, [{ ...creator, assets: { thumbnail: "https://images.example/new.png", gallery: [] } }], "https://data.example/", noRequest);
    expect(changedSource!.assets.icon).toBe(first!.assets.icon);
    const [noThumbnail] = await generateCreatorIcons(root, [{ ...creator, assets: { thumbnail: null, gallery: [] } }], "https://data.example/", noRequest);
    expect(noThumbnail!.assets.icon).toBe(first!.assets.icon);
    expect(requests).toBe(0);
    await rm(file);
    const replacement = await sharp({ create: { width: 80, height: 80, channels: 3, background: "green" } }).png().toBuffer();
    const [changed] = await generateCreatorIcons(root, [creator], "https://data.example/", (async () => new Response(replacement)));
    expect(changed!.assets.icon).not.toBe(first!.assets.icon);
    expect((await sharp(await readFile(path.join(root, "public", new URL(changed!.assets.icon!).pathname))).metadata()).width).toBe(40);
    const [removed] = await generateCreatorIcons(root, [{ ...creator, assets: { thumbnail: null, icon: changed!.assets.icon, gallery: [] } }], "https://data.example/", request);
    expect(removed!.assets.icon).toBe(changed!.assets.icon);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("local manual art needs no network and corrupt sources retain the fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cf23-icons-"));
  try {
    await mkdir(path.join(root, "config"), { recursive: true });
    await writeFile(path.join(root, "config/creator-icons.json"), JSON.stringify({ size: 80, quality: 75, crop: { centerX: 0.5, centerY: 0.55, shortSideScale: 0.9 } }));
    await mkdir(path.join(root, "public/images/manual"), { recursive: true });
    await sharp({ create: { width: 30, height: 50, channels: 3, background: "yellow" } }).png().toFile(path.join(root, "public/images/manual/cut.png"));
    const [local] = await generateCreatorIcons(root, [{ ...creator, assets: { thumbnail: "https://data.example/base/images/manual/cut.png", gallery: [] } }], "https://data.example/base/", (async () => { throw Error("No network allowed"); }));
    expect(local!.assets.icon).toMatch(/^https:\/\/data.example\/base\/images\/icons\/[a-f0-9]+\.webp$/);
    const [broken] = await generateCreatorIcons(root, [{ ...creator, id: "2" }], "https://data.example/", (async () => new Response("not an image")));
    expect(broken!.assets.icon).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
