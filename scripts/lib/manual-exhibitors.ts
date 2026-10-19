import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CanonicalExhibitorInput, EventConfig, FandomRegistry, ManualExhibitorInput } from "../types.ts";
import { mapEventCatalog, type MappedEvent } from "./map-event.ts";

// Keep IDs compatible with the app's integer IDs and compact shared-list encoding.
export const MANUAL_ID_MIN = 1_000_000;
export const MANUAL_ID_MAX = 1_999_999;
const fields = new Set(["id", "name", "spaces", "attendanceDates", "contentRating",
  "fandoms", "offerings", "assets", "links", "catalogUrl", "category", "sourceUrls"]);

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

function positiveId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647;
}

function validate(value: Record<string, unknown>, event: EventConfig): void {
  const id = value.id;
  requireValue(typeof value.name === "string" && value.name.trim(), `${id}: name is required`);
  requireValue(Array.isArray(value.spaces) && value.spaces.length > 0 && value.spaces.every(space =>
    object(space) && typeof space.code === "string" && space.code.trim() &&
    (space.type === null || typeof space.type === "string")), `${id}: invalid spaces`);
  requireValue(strings(value.attendanceDates) && value.attendanceDates.every(date =>
    event.days.some(day => day.id === date)), `${id}: invalid attendanceDates`);
  requireValue(value.contentRating === null || typeof value.contentRating === "string", `${id}: invalid contentRating`);
  requireValue(strings(value.fandoms), `${id}: fandoms must be an array of nonempty strings`);
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
  exhibitors: CanonicalExhibitorInput[];
  additions: unknown;
  overrides: unknown;
  idMappings?: unknown;
  event: EventConfig;
  registry: FandomRegistry;
  publicBaseUrl: string;
  publicDirectory: string;
}): Promise<MappedEvent> {
  requireValue(httpUrl(options.publicBaseUrl), "publicBaseUrl must be an absolute HTTP(S) URL");
  const base = new URL(options.publicBaseUrl);
  requireValue(!base.search && !base.hash && base.pathname.endsWith("/"), "publicBaseUrl must end in / with no query or fragment");
  requireValue(Array.isArray(options.additions) && Array.isArray(options.overrides), "inputs must be arrays");
  const additions = new Map<string, Record<string, unknown> & { id: string }>();
  for (const addition of options.additions) {
    record(addition);
    requireValue(Number(addition.id) >= MANUAL_ID_MIN && Number(addition.id) <= MANUAL_ID_MAX,
      `${addition.id}: manual IDs must be in ${MANUAL_ID_MIN}–${MANUAL_ID_MAX}`);
    requireValue(!additions.has(addition.id), `addition ID already exists: ${addition.id}`);
    additions.set(addition.id, addition);
  }
  const mappings = options.idMappings === undefined ? [] : options.idMappings;
  requireValue(Array.isArray(mappings), "id-mappings.json must be an array");
  const manualIdByOfficialId = new Map<string, string>();
  const mappedManualIds = new Set<string>();
  for (const mapping of mappings) {
    requireValue(object(mapping) && Object.keys(mapping).every(key => key === "officialId" || key === "manualId") &&
      positiveId(mapping.officialId) && positiveId(mapping.manualId), "each ID mapping must contain officialId and manualId as positive integer strings");
    requireValue(mapping.officialId !== mapping.manualId, "officialId and manualId must differ");
    requireValue(!manualIdByOfficialId.has(mapping.officialId), `duplicate mapping for official ID ${mapping.officialId}`);
    requireValue(!mappedManualIds.has(mapping.manualId), `multiple official IDs map to manual ID ${mapping.manualId}`);
    requireValue(additions.has(mapping.manualId), `mapped manual ID not found in exhibitors.json: ${mapping.manualId}`);
    manualIdByOfficialId.set(mapping.officialId, mapping.manualId);
    mappedManualIds.add(mapping.manualId);
  }
  for (const officialId of manualIdByOfficialId.keys()) {
    requireValue(!mappedManualIds.has(officialId), `ID mappings cannot form chains: ${officialId}`);
  }
  const result = new Map<string, ManualExhibitorInput>();
  const upstreamIds = new Set<string>();
  const officialBackedIds = new Set<string>();
  const activeOfficialIds = new Set<string>();
  for (const exhibitor of options.exhibitors) {
    requireValue(!upstreamIds.has(exhibitor.id), `duplicate upstream ID ${exhibitor.id}`);
    upstreamIds.add(exhibitor.id);
    const mappedId = manualIdByOfficialId.get(exhibitor.id);
    const publicId = mappedId ?? exhibitor.id;
    requireValue(!result.has(publicId), `public ID collision after mapping: ${publicId}`);
    requireValue(!additions.has(exhibitor.id),
      `addition ID already exists: ${exhibitor.id}`);
    const { fandomSourceFields, ...fields } = exhibitor;
    result.set(publicId, { ...fields, id: publicId, fandoms: fandomSourceFields,
      ...(mappedId === undefined ? {} : { catalogUrl: exhibitor.catalogUrl ?? null }),
    });
    if (mappedId !== undefined) {
      officialBackedIds.add(publicId);
      activeOfficialIds.add(exhibitor.id);
    }
  }
  const touched = new Set<string>();
  for (const addition of additions.values()) {
    // The official record supplies every field once its explicit mapping exists.
    if (officialBackedIds.has(addition.id)) continue;
    requireValue(!result.has(addition.id), `addition ID already exists: ${addition.id}`);
    // Explicit null prevents the app from inventing a Comifuro catalog page.
    result.set(addition.id, { catalogUrl: null, fandoms: [], ...addition } as unknown as ManualExhibitorInput);
    touched.add(addition.id);
  }
  const patched = new Set<string>();
  for (const override of options.overrides) {
    record(override);
    requireValue(!patched.has(override.id), `duplicate override ${override.id}`);
    patched.add(override.id);
    if (officialBackedIds.has(override.id) || activeOfficialIds.has(override.id)) continue;
    requireValue(result.has(override.id), `override target not found: ${override.id}`);
    result.set(override.id, { ...result.get(override.id)!, ...override } as ManualExhibitorInput);
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
    validate(exhibitor as unknown as Record<string, unknown>, options.event);
    const assets = exhibitor.assets;
    result.set(id, { ...exhibitor, assets: {
      thumbnail: assets.thumbnail === null ? null : await imageUrl(assets.thumbnail),
      gallery: await Promise.all(assets.gallery.map(imageUrl)),
    } });
  }
  // Resolve the final merged records so overridden fields cannot submit stale
  // upstream text. Only the derived IDs are included in the public catalog.
  return mapEventCatalog({ records: [...result.values()], event: options.event,
    registry: options.registry, adapter: {
      toCanonicalInput(exhibitor) {
        const { fandoms, ...fields } = exhibitor;
        return { ...fields, fandomSourceFields: fandoms };
      },
    },
  });
}

export async function loadManualExhibitors(root: string, exhibitors: CanonicalExhibitorInput[], event: EventConfig, registry: FandomRegistry): Promise<MappedEvent> {
  const json = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  requireValue(publicBaseUrl, "set PUBLIC_BASE_URL to the public site URL ending in / (GitHub Actions repository variable or local environment variable)");
  return mergeManualExhibitors({ exhibitors, event, registry,
    additions: await json("data/manual/exhibitors.json"),
    overrides: await json("data/manual/overrides.json"),
    idMappings: await json("data/manual/id-mappings.json"),
    publicBaseUrl,
    publicDirectory: path.join(root, "public"),
  });
}
