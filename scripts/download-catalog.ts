import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverCatalogConnection } from "./lib/comifuro-source.ts";
import type { CatalogSnapshot, RawCircle } from "./types.ts";

const connection = await discoverCatalogConnection();
const endpoint = `${connection.url}/rest/v1/circle_data?select=*&order=id.asc`;

const response = await fetch(endpoint, {
  headers: { apikey: connection.anonKey, Authorization: `Bearer ${connection.anonKey}` },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`Catalog download failed: ${response.status} ${await response.text()}`);

const circles = await response.json() as RawCircle[];
if (!Array.isArray(circles) || circles.length === 0) throw new Error("Catalog returned no circles");

const snapshot: CatalogSnapshot = {
  schemaVersion: 1,
  source: "https://catalog.comifuro.net",
  downloadedAt: new Date().toISOString(),
  recordCount: circles.length,
  circles,
};
const output = path.resolve("data/raw/catalog.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${circles.length} catalog records to ${output}`);
