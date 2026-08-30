import type { FandomRegistry, RegistryMetadata } from "../types.ts";

export const registryUrl = "https://fandom.directory/api/fandoms.json";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RegistryRefreshResult {
  registry: FandomRegistry;
  meta: RegistryMetadata;
  changed: boolean;
  warning?: string;
}

function isFandomRegistry(value: unknown): value is FandomRegistry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FandomRegistry>;
  return Array.isArray(candidate.ignored)
    && candidate.ignored.every((item) => typeof item === "string")
    && Array.isArray(candidate.fandoms)
    && candidate.fandoms.every((fandom) => fandom
      && typeof fandom.id === "number"
      && typeof fandom.name === "string"
      && typeof fandom.kind === "string"
      && (fandom.parentId === null || typeof fandom.parentId === "number")
      && Array.isArray(fandom.aliases)
      && fandom.aliases.every((alias) => typeof alias === "string")
      && Array.isArray(fandom.alternateNames)
      && fandom.alternateNames.every((name) => typeof name === "string"));
}

export async function fetchRegistryWithFallback(options: {
  previousRegistry?: FandomRegistry;
  previousMeta?: RegistryMetadata;
  fetcher?: Fetcher;
}): Promise<RegistryRefreshResult> {
  const previousMeta = options.previousMeta ?? {};
  const fallback = (reason: string): RegistryRefreshResult => {
    if (!options.previousRegistry) {
      throw new Error(`${reason}; no cached fandom.directory registry is available`);
    }
    return {
      registry: options.previousRegistry,
      meta: previousMeta,
      changed: false,
      warning: `${reason}; using the cached fandom.directory registry`,
    };
  };

  const headers = new Headers();
  if (previousMeta.etag) headers.set("If-None-Match", previousMeta.etag);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(registryUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return fallback(`Fandom registry request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status === 304) {
    return options.previousRegistry
      ? { registry: options.previousRegistry, meta: previousMeta, changed: false }
      : fallback("Fandom registry returned 304 Not Modified");
  }
  if (!response.ok) return fallback(`Fandom registry returned HTTP ${response.status}`);

  let registry: FandomRegistry;
  try {
    registry = await response.json() as FandomRegistry;
  } catch (error) {
    return fallback(`Fandom registry returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isFandomRegistry(registry)) {
    return fallback("Fandom registry returned an unexpected schema");
  }

  return {
    registry,
    changed: true,
    meta: {
      source: registryUrl,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      schemaVersion: response.headers.get("x-registry-schema-version"),
    },
  };
}
