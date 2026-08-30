export interface SupabaseConnection {
  url: string;
  anonKey: string;
}

export function extractSupabaseConnection(source: string): SupabaseConnection | undefined {
  const match = source.match(/(https:\/\/[a-z0-9-]+\.supabase\.co)["']\s*,\s*["'](eyJ[A-Za-z0-9._-]+)/i);
  return match?.[1] && match[2] ? { url: match[1], anonKey: match[2] } : undefined;
}

export async function discoverCatalogConnection(): Promise<SupabaseConnection> {
  const catalogUrl = "https://catalog.comifuro.net/catalog/";
  const pageResponse = await fetch(catalogUrl, { signal: AbortSignal.timeout(30_000) });
  if (!pageResponse.ok) throw new Error(`Catalog page returned HTTP ${pageResponse.status}`);
  const html = await pageResponse.text();
  const scriptUrls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value, catalogUrl));

  for (const scriptUrl of scriptUrls) {
    if (scriptUrl.origin !== new URL(catalogUrl).origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const connection = extractSupabaseConnection(await response.text());
    if (connection) return connection;
  }
  throw new Error("Could not discover the catalog's public Supabase connection");
}
