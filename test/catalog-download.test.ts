import { expect, test } from "bun:test";
import { downloadCatalogCircles } from "../scripts/lib/catalog-download.ts";

const connection = { url: "https://example.supabase.co", anonKey: "public-test-key" };

test("catalog download follows the advertised total across capped pages", async () => {
  const requests: string[] = [];
  const request = async (url: string, options?: RequestInit) => {
    requests.push(String(url));
    expect(new Headers(options?.headers).get("Prefer")).toBe("count=exact");
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    const end = Math.min(offset + 499, 1956);
    return Response.json(Array.from({ length: end - offset + 1 }, (_, i) => ({ id: offset + i + 1 })), {
      headers: { "content-range": `${offset}-${end}/1957` },
    });
  };
  const records = await downloadCatalogCircles(connection, request);
  expect(records).toHaveLength(1957);
  expect(records.at(-1)?.id).toBe(1957);
  expect(requests.map(url => new URL(url).searchParams.get("offset"))).toEqual(["0", "500", "1000", "1500"]);
});

test("catalog download rejects incomplete, duplicate, and changing snapshots", async () => {
  for (const failure of ["missing-range", "incomplete", "duplicate", "changed-count", "wrong-offset"]) {
    let page = 0;
    const request = async () => {
      page++;
      const range: Record<string, string> = failure === "missing-range" ? {} : { "content-range": page === 1 ? "0-0/2" :
        failure === "changed-count" ? "1-1/3" : failure === "wrong-offset" ? "0-0/2" : "1-1/2" };
      return Response.json(failure === "incomplete" ? [] : [{ id: failure === "duplicate" ? 1 : page }], { headers: range });
    };
    await expect(downloadCatalogCircles(connection, request)).rejects.toThrow();
  }
});
