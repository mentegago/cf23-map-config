import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { comifuroAdapter } from "./adapters/comifuro.ts";
import { fetchRegistryWithFallback } from "./lib/fandom-directory.ts";
import { mapEventCatalog } from "./lib/map-event.ts";
import type {
  CatalogSnapshot,
  EventConfig,
  FandomRegistry,
  RegistryMetadata,
} from "./types.ts";

const root = process.cwd();
const rawCatalogPath = path.join(root, "data/raw/catalog.json");
const eventConfigPath = path.join(root, "config/event.json");
const registryPath = path.join(root, "data/raw/fandom-directory.json");
const registryMetaPath = path.join(root, "data/raw/fandom-directory.meta.json");
const submissionStatePath = path.join(root, "data/raw/fandom-submissions.json");
const publicationStatePath = path.join(root, "data/raw/publication.json");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

async function refreshRegistry(): Promise<{ registry: FandomRegistry; meta: RegistryMetadata }> {
  let previousMeta: RegistryMetadata = {};
  let previousRegistry: FandomRegistry | undefined;
  try {
    previousMeta = await readJson<RegistryMetadata>(registryMetaPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  try {
    previousRegistry = await readJson<FandomRegistry>(registryPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const result = await fetchRegistryWithFallback({ previousRegistry, previousMeta });
  if (result.warning) console.warn(result.warning);
  if (result.changed) {
    await writeJson(registryPath, result.registry);
    await writeJson(registryMetaPath, result.meta);
  }
  return { registry: result.registry, meta: result.meta };
}

interface SubmissionState { submittedSourceFields: string[] }

async function submitUnknowns(fields: string[]): Promise<{ pending: number; responses: unknown[] }> {
  let state: SubmissionState = { submittedSourceFields: [] };
  try {
    state = await readJson<SubmissionState>(submissionStatePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const current = new Set(fields);
  const previouslySubmitted = new Set(state.submittedSourceFields.filter((field) => current.has(field)));
  const pending = fields.filter((field) => !previouslySubmitted.has(field));
  if (pending.length === 0) {
    if (state.submittedSourceFields.length !== previouslySubmitted.size) {
      await writeJson(submissionStatePath, { submittedSourceFields: [...previouslySubmitted].sort() });
    }
    return { pending: 0, responses: [] };
  }

  const apiKey = process.env.FANDOM_DIRECTORY_API_KEY;
  if (!apiKey) {
    const message = `FANDOM_DIRECTORY_API_KEY is unset; ${pending.length} unknown source fields were not submitted.`;
    console.warn(message);
    return { pending: pending.length, responses: [] };
  }

  const responses: unknown[] = [];
  for (let offset = 0; offset < pending.length; offset += 5000) {
    const items = pending.slice(offset, offset + 5000);
    try {
      const response = await fetch("https://fandom.directory/api/v1/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        console.warn(`Unknown fandom submission returned HTTP ${response.status}; continuing without blocking publication.`);
        continue;
      }
      try {
        responses.push(await response.json());
      } catch {
        responses.push({ status: response.status, accepted: true });
      }
      for (const item of items) previouslySubmitted.add(item);
    } catch (error) {
      console.warn(`Unknown fandom submission failed; continuing without blocking publication: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeJson(submissionStatePath, { submittedSourceFields: [...previouslySubmitted].sort() });
  return {
    pending: pending.filter((item) => !previouslySubmitted.has(item)).length,
    responses,
  };
}

const catalog = await readJson<CatalogSnapshot>(rawCatalogPath);
const eventConfig = await readJson<EventConfig>(eventConfigPath);
if (!Array.isArray(catalog.circles)) throw new Error("data/raw/catalog.json has an unexpected schema");
const { registry, meta } = await refreshRegistry();
const mapped = mapEventCatalog({
  records: catalog.circles,
  event: eventConfig,
  registry,
  adapter: comifuroAdapter,
});

const fandoms = [...registry.fandoms]
  .sort((a, b) => a.id - b.id)
  .map(({ id, name, kind, parentId }) => ({ id, name, kind, parentId }));
const source = {
  catalog: { url: catalog.source, downloadedAt: catalog.downloadedAt },
  fandomDirectory: {
    url: meta.source,
    etag: meta.etag,
    lastModified: meta.lastModified,
    schemaVersion: meta.schemaVersion,
  },
};

const catalogDocument = {
  schemaVersion: "1.0.0",
  sources: source,
  event: {
    id: eventConfig.id,
    name: eventConfig.name,
    series: eventConfig.series,
    edition: eventConfig.edition,
    days: eventConfig.days,
  },
  stats: {
    exhibitors: mapped.exhibitors.length,
    fandomsReferenced: new Set(mapped.exhibitors.flatMap((item) => item.fandomIds)).size,
  },
  exhibitors: mapped.exhibitors,
};
const fandomDocument = {
  schemaVersion: "1.0.0",
  source: source.fandomDirectory,
  fandoms,
};
const manifestDocument = {
  schemaVersion: "1.0.0",
  event: { id: eventConfig.id, name: eventConfig.name },
  catalog: "v1/catalog.json",
  fandomRegistry: "v1/fandoms.json",
};
let lastUpdatedCustomFields: Record<string, unknown> = {};
try {
  const { lastUpdated: _managedTimestamp, ...customFields } = await readJson<Record<string, unknown>>(
    path.join(root, "public/last-updated.json"),
  );
  lastUpdatedCustomFields = customFields;
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ manifestDocument, catalogDocument, fandomDocument, lastUpdatedCustomFields }))
  .digest("hex");
let publicationState: { fingerprint?: string; lastUpdated?: string } = {};
try {
  publicationState = await readJson(publicationStatePath);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const lastUpdated = publicationState.fingerprint === fingerprint && publicationState.lastUpdated
  ? publicationState.lastUpdated
  : new Date().toISOString();

await writeJson(path.join(root, "public/v1/catalog.json"), catalogDocument);
await writeJson(path.join(root, "public/v1/fandoms.json"), fandomDocument);
await writeJson(path.join(root, "public/manifest.json"), manifestDocument);
await writeJson(path.join(root, "public/last-updated.json"), { ...lastUpdatedCustomFields, lastUpdated });
await writeJson(publicationStatePath, { fingerprint, lastUpdated });
await writeJson(path.join(root, "data/unmapped-fandoms.json"), {
  schemaVersion: 1,
  source: source.fandomDirectory,
  stats: mapped.stats,
  unknownSourceFields: mapped.unknownSourceFields,
});

const submission = await submitUnknowns(mapped.unknownSourceFields);
console.log(JSON.stringify({
  eventId: eventConfig.id,
  exhibitors: mapped.exhibitors.length,
  ...mapped.stats,
  submission,
}, null, 2));
