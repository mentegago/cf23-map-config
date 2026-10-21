import type { RawCircle } from "../types.ts";
import type { SupabaseConnection } from "./comifuro-source.ts";

export async function downloadCatalogCircles(connection: SupabaseConnection,
  request: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<RawCircle[]> {
  const circles: RawCircle[] = [];
  const ids = new Set<number>();
  let total: number | undefined;
  do {
    const endpoint = `${connection.url}/rest/v1/circle_data?select=*&order=id.asc&offset=${circles.length}&limit=1000`;
    const response = await request(endpoint, {
      headers: { apikey: connection.anonKey, Authorization: `Bearer ${connection.anonKey}`, Prefer: "count=exact" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Catalog download failed: ${response.status} ${await response.text()}`);
    const range = response.headers.get("content-range")?.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (!range || Number(range[1]) !== circles.length) throw new Error("Catalog returned an invalid page range");
    const count = Number(range[3]);
    if (total !== undefined && total !== count) throw new Error("Catalog record count changed during download; retry refresh");
    total = count;
    const page: unknown = await response.json();
    if (!Array.isArray(page) || page.length === 0 || page.length !== Number(range[2]) - Number(range[1]) + 1) {
      throw new Error("Catalog returned an incomplete page");
    }
    for (const circle of page as RawCircle[]) {
      if (!Number.isSafeInteger(circle.id) || circle.id <= 0 || ids.has(circle.id)) throw new Error("Catalog returned invalid or duplicate IDs");
      ids.add(circle.id);
      circles.push(circle);
    }
    if (circles.length > total) throw new Error("Catalog returned more records than its advertised count");
  } while (circles.length < total);
  return circles;
}
