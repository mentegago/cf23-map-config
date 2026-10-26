import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CanonicalExhibitor } from "../types.ts";
import { iconCrop, validateIconSettings } from "./icon-crop.ts";

type Entry = { source: string; digest: string; file: string; etag?: string; modified?: string };
type Cache = { recipe: string; entries: Record<string, Entry> };
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const exists = async (file: string) => access(file).then(() => true, () => false);

export async function generateCreatorIcons(
  root: string,
  exhibitors: CanonicalExhibitor[],
  publicBaseUrl: string,
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
) {
  const settings = validateIconSettings(JSON.parse(await readFile(path.join(root, "config/creator-icons.json"), "utf8")));
  const recipe = `crop-v2-${hash(Buffer.from(JSON.stringify(settings)))}`;
  const base = new URL(publicBaseUrl);
  const cacheFile = path.join(root, "data/raw/creator-icons.json");
  let previous: Cache = { recipe, entries: {} };
  try {
    const saved = JSON.parse(await readFile(cacheFile, "utf8")) as Cache;
    previous = saved;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const entries: Record<string, Entry> = {};
  const result = [...exhibitors];
  let cursor = 0, failed = 0, generated = 0;
  await mkdir(path.join(root, "public/images/icons"), { recursive: true });
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < exhibitors.length) {
      const index = cursor++;
      const creator = exhibitors[index]!;
      const { icon: _oldIcon, ...assets } = creator.assets;
      result[index] = { ...creator, assets };
      const source = assets.thumbnail;
      const saved = previous.entries[creator.id];
      const cached = saved && /^images\/icons\/[a-f0-9]{64}\.webp$/.test(saved.file) &&
        await exists(path.join(root, "public", saved.file)) ? saved : undefined;
      if (cached) {
        entries[creator.id] = cached;
        result[index] = { ...creator, assets: { ...assets, icon: new URL(cached.file, base).href } };
        continue;
      }
      if (!source) continue;
      try {
        const url = new URL(source);
        if (!["http:", "https:"].includes(url.protocol)) throw Error("Unsupported image URL");
        let body: Buffer | undefined, etag: string | undefined, modified: string | undefined;
        // Manual images have already been validated by the input loader.
        const relative = url.origin === base.origin && url.pathname.startsWith(base.pathname)
          ? decodeURIComponent(url.pathname.slice(base.pathname.length)) : "";
        if (/^images\/(?:[\w-]+\/)*[\w.-]+$/.test(relative)) {
          body = await readFile(path.join(root, "public", relative));
        } else {
          const response = await request(url.href, { signal: AbortSignal.timeout(20_000) });
          if (!response.ok) throw Error(`Image HTTP ${response.status}`);
          if (Number(response.headers.get("content-length")) > 12 * 1024 * 1024) throw Error("Image too large");
          body = Buffer.from(await response.arrayBuffer());
          etag = response.headers.get("etag") ?? undefined;
          modified = response.headers.get("last-modified") ?? undefined;
        }
        if (body.length > 12 * 1024 * 1024) throw Error("Image too large");
        const digest = hash(body);
        let file: string;
        {
          const oriented = await sharp(body, { limitInputPixels: 40_000_000 })
            .rotate().raw().toBuffer({ resolveWithObject: true });
          const output = await sharp(oriented.data, { raw: oriented.info })
            .extract(iconCrop(oriented.info.width, oriented.info.height, settings.crop))
            .resize(settings.size, settings.size)
            .webp({ quality: settings.quality }).toBuffer();
          file = `images/icons/${hash(output)}.webp`;
          if (!await exists(path.join(root, "public", file)))
            await writeFile(path.join(root, "public", file), output);
          generated++;
        }
        entries[creator.id] = { source, digest, file, ...(etag ? { etag } : {}), ...(modified ? { modified } : {}) };
        result[index] = { ...creator, assets: { ...assets, icon: new URL(file, base).href } };
      } catch {
        failed++;
      }
    }
  }));
  // Retain old image files so installed apps with older catalogs keep working.
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(`${cacheFile}.tmp`, JSON.stringify({ recipe, entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + "\n");
  await rename(`${cacheFile}.tmp`, cacheFile);
  console.log(`Creator icons: ${Object.keys(entries).length} available, ${generated} generated, ${failed} unavailable sources.`);
  return result;
}
