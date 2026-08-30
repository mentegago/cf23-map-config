import { expect, test } from "bun:test";
import { fetchRegistryWithFallback } from "../scripts/lib/fandom-directory.ts";
import type { FandomRegistry } from "../scripts/types.ts";

const cached: FandomRegistry = {
  fandoms: [{ id: 1, name: "Cached", kind: "franchise", parentId: null, aliases: ["cached"] }],
  ignored: [],
};

test("uses cached registry when fandom.directory is unreachable", async () => {
  const result = await fetchRegistryWithFallback({
    previousRegistry: cached,
    previousMeta: { etag: '"old"' },
    fetcher: async () => { throw new Error("offline"); },
  });
  expect(result.registry).toBe(cached);
  expect(result.changed).toBe(false);
  expect(result.warning).toContain("using the cached");
});

test("uses cached registry on server errors and malformed payloads", async () => {
  const unavailable = await fetchRegistryWithFallback({
    previousRegistry: cached,
    fetcher: async () => new Response("nope", { status: 503 }),
  });
  const malformed = await fetchRegistryWithFallback({
    previousRegistry: cached,
    fetcher: async () => Response.json({
      fandoms: [{ id: 2, name: "Broken", kind: "franchise", parentId: null }],
      ignored: [],
    }),
  });
  expect(unavailable.registry).toBe(cached);
  expect(malformed.registry).toBe(cached);
});

test("still requires a cache for the first-ever build", async () => {
  await expect(fetchRegistryWithFallback({
    fetcher: async () => { throw new Error("offline"); },
  })).rejects.toThrow("no cached fandom.directory registry");
});
