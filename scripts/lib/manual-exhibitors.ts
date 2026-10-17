import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CanonicalExhibitor, EventConfig } from "../types.ts";

// Keep IDs compatible with the app's integer IDs and compact shared-list encoding.
export const MANUAL_ID_MIN = 1_000_000;
export const MANUAL_ID_MAX = 1_999_999;
const fields = new Set(["id", "name", "spaces", "attendanceDates", "contentRating",
  "fandomIds", "offerings", "assets", "links", "catalogUrl", "category", "sourceUrls"]);

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Manual exhibitors: ${message}`);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string" && item.trim().length > 0);
}
function httpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
function record(value: unknown): asserts value is Record<string, unknown> & { id: string } {
  requireValue(object(value), "each entry must be an object");
  requireValue(typeof value.id === "string" && /^[1-9]\d*$/.test(value.id) &&
    Number.isSafeInteger(Number(value.id)) && Number(value.id) <= 2_147_483_647,
  "IDs must be positive integer strings no larger than 2147483647");
  for (const key of Object.keys(value)) requireValue(fields.has(key), `unknown field ${key} on ${value.id}`);
}

function validate(value: Record<string, unknown>, event: EventConfig, fandomIds: Set<number>): void {
  const id = value.id;
  requireValue(typeof value.name === "string" && value.name.trim(), `${id}: name is required`);
  requireValue(Array.isArray(value.spaces) && value.spaces.length > 0 && value.spaces.every(space =>
    object(space) && typeof space.code === "string" && space.code.trim() &&
    (space.type === null || typeof space.type === "string")), `${id}: invalid spaces`);
  requireValue(strings(value.attendanceDates) && value.attendanceDates.every(date =>
    event.days.some(day => day.id === date)), `${id}: invalid attendanceDates`);
  requireValue(value.contentRating === null || typeof value.contentRating === "string", `${id}: invalid contentRating`);
  requireValue(Array.isArray(value.fandomIds) && value.fandomIds.every(fandom =>
    Number.isInteger(fandom) && fandomIds.has(fandom)), `${id}: unknown fandom IDs`);
  requireValue(strings(value.offerings), `${id}: invalid offerings`);
  requireValue(object(value.assets) && (value.assets.thumbnail === null || typeof value.assets.thumbnail === "string") &&
    strings(value.assets.gallery), `${id}: invalid assets`);
  requireValue(Array.isArray(value.links) && value.links.every(link => object(link) &&
    typeof link.type === "string" && link.type.trim() && httpUrl(link.url)), `${id}: invalid links`);
  requireValue(value.catalogUrl === undefined || value.catalogUrl === null || httpUrl(value.catalogUrl), `${id}: invalid catalogUrl`);
  requireValue(value.category === undefined || (typeof value.category === "string" && value.category.trim()), `${id}: invalid category`);
  requireValue(value.sourceUrls === undefined || (strings(value.sourceUrls) && value.sourceUrls.every(httpUrl)), `${id}: invalid sourceUrls`);
}

export async function mergeManualExhibitors(options: {
  exhibitors: CanonicalExhibitor[];
  additions: unknown;
  overrides: unknown;
  event: EventConfig;
  fandomIds: Set<number>;
  publicBaseUrl: string;
  publicDirectory: string;
}): Promise<CanonicalExhibitor[]> {
  requireValue(httpUrl(options.publicBaseUrl), "publicBaseUrl must be an absolute HTTP(S) URL");
  const base = new URL(options.publicBaseUrl);
  requireValue(!base.search && !base.hash && base.pathname.endsWith("/"), "publicBaseUrl must end in / with no query or fragment");
  requireValue(Array.isArray(options.additions) && Array.isArray(options.overrides), "inputs must be arrays");
  const result = new Map<string, CanonicalExhibitor>();
  for (const exhibitor of options.exhibitors) {
    requireValue(!result.has(exhibitor.id), `duplicate upstream ID ${exhibitor.id}`);
    result.set(exhibitor.id, exhibitor);
  }
  const touched = new Set<string>();
  for (const addition of options.additions) {
    record(addition);
    requireValue(Number(addition.id) >= MANUAL_ID_MIN && Number(addition.id) <= MANUAL_ID_MAX,
      `${addition.id}: manual IDs must be in ${MANUAL_ID_MIN}–${MANUAL_ID_MAX}`);
    requireValue(!result.has(addition.id), `addition ID already exists: ${addition.id}`);
    // Explicit null prevents the app from inventing a Comifuro catalog page.
    result.set(addition.id, { catalogUrl: null, ...addition } as unknown as CanonicalExhibitor);
    touched.add(addition.id);
  }
  const patched = new Set<string>();
  for (const override of options.overrides) {
    record(override);
    requireValue(!patched.has(override.id), `duplicate override ${override.id}`);
    requireValue(result.has(override.id), `override target not found: ${override.id}`);
    patched.add(override.id);
    result.set(override.id, { ...result.get(override.id)!, ...override } as CanonicalExhibitor);
    touched.add(override.id);
  }
  async function imageUrl(value: string): Promise<string> {
    if (httpUrl(value)) return value;
    requireValue(/^images\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(value),
      `invalid image path: ${value}; use images/... or an absolute HTTP(S) URL`);
    const imageRoot = await realpath(path.join(options.publicDirectory, "images"));
    const file = await realpath(path.join(options.publicDirectory, value));
    const relative = path.relative(imageRoot, file);
    requireValue(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `image escapes public/images: ${value}`);
    requireValue((await stat(file)).isFile(), `image is not a file: ${value}`);
    return new URL(value, base).href;
  }
  for (const id of touched) {
    const exhibitor = result.get(id)!;
    validate(exhibitor as unknown as Record<string, unknown>, options.event, options.fandomIds);
    const assets = exhibitor.assets;
    result.set(id, { ...exhibitor, assets: {
      thumbnail: assets.thumbnail === null ? null : await imageUrl(assets.thumbnail),
      gallery: await Promise.all(assets.gallery.map(imageUrl)),
    } });
  }
  return [...result.values()];
}

export async function loadManualExhibitors(root: string, exhibitors: CanonicalExhibitor[], event: EventConfig, fandomIds: Set<number>): Promise<CanonicalExhibitor[]> {
  const json = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  requireValue(publicBaseUrl, "set PUBLIC_BASE_URL to the public site URL ending in / (GitHub Actions repository variable or local environment variable)");
  return mergeManualExhibitors({ exhibitors, event, fandomIds,
    additions: await json("data/manual/exhibitors.json"),
    overrides: await json("data/manual/overrides.json"),
    publicBaseUrl,
    publicDirectory: path.join(root, "public"),
  });
}
