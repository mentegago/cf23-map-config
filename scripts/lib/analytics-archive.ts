import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

export interface AnalyticsSnapshot {
  catalog: Record<string, any>;
  fandoms: Record<string, any>;
  manifest: Record<string, any>;
  version: Record<string, any>;
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function archiveAnalytics(root: string, snapshot: AnalyticsSnapshot): Promise<boolean> {
  const { catalog, fandoms, manifest, version } = snapshot;
  const edition = catalog.event?.id;
  const number = version.creator_data_version;
  if (typeof edition !== 'string' || !/^[a-z0-9-]+$/.test(edition) ||
      !Number.isSafeInteger(number) || number < 0 || !Array.isArray(catalog.exhibitors) ||
      !Array.isArray(fandoms.fandoms) || !String(manifest.schemaVersion).startsWith('1.')) {
    throw new Error('Unsupported analytics snapshot');
  }
  // Download timestamps, source headers, and release notices are not semantic.
  const semanticHash = hash({ catalog: {schemaVersion: catalog.schemaVersion,
    event: catalog.event, stats: catalog.stats, exhibitors: catalog.exhibitors},
    fandoms: {schemaVersion: fandoms.schemaVersion, fandoms: fandoms.fandoms}, manifest });
  const folder = path.join(root, 'data/analytics', edition, String(number));
  try {
    const existing = JSON.parse(await readFile(path.join(folder, 'index.json'), 'utf8'));
    if (existing.semanticHash !== semanticHash) throw new Error(`Analytics version conflict: ${edition}/${number}`);
    const body = await readFile(path.join(folder, 'snapshot.json.gz'));
    if (createHash('sha256').update(body).digest('hex') !== existing.archiveHash) throw new Error('Analytics archive integrity failure');
    return false;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(folder, { recursive: true });
  const body = gzipSync(Buffer.from(JSON.stringify(canonical(snapshot))));
  const index = { schemaVersion: 1, event: edition, creatorDataVersion: number, semanticHash,
    archiveHash: createHash('sha256').update(body).digest('hex'),
    documentHashes: Object.fromEntries(Object.entries(snapshot).map(([key,value]) => [key,hash(value)])) };
  await writeFile(path.join(folder, 'snapshot.json.gz'), body, {flag: 'wx'});
  await writeFile(path.join(folder, 'index.json'), JSON.stringify(index, null, 2) + '\n', {flag: 'wx'});
  return true;
}
