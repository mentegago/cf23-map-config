import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverCatalogConnection } from "./lib/comifuro-source.ts";
import { preserveUnchangedSnapshot } from "./lib/catalog-snapshot.ts";
import { downloadCatalogCircles } from "./lib/catalog-download.ts";
import type { CatalogSnapshot } from "./types.ts";

const connection = await discoverCatalogConnection();
const circles = await downloadCatalogCircles(connection);

const snapshot: CatalogSnapshot = {
  schemaVersion: 1,
  source: "https://catalog.comifuro.net",
  downloadedAt: new Date().toISOString(),
  recordCount: circles.length,
  circles,
};
const output = path.resolve("data/raw/catalog.json");
let previous: CatalogSnapshot | undefined;
try {
  previous = JSON.parse(await readFile(output, "utf8")) as CatalogSnapshot;
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
if (preserveUnchangedSnapshot(previous, snapshot) === previous) {
  console.log(`Catalog unchanged (${circles.length} records); keeping the existing snapshot.`);
  process.exit(0);
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${circles.length} catalog records to ${output}`);
