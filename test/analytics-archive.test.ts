import { expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { archiveAnalytics } from '../scripts/lib/analytics-archive.ts';

test('archive is immutable, idempotent, and keeps attendance and hierarchy', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'cf23-archive-'));
  const snapshot = {catalog:{schemaVersion:'1.0.0',event:{id:'cf23'},stats:{},
    exhibitors:[{id:1,fandomIds:[2],attendanceDates:['2026-10-31']}]},
    fandoms:{schemaVersion:'1.0.0',fandoms:[{id:2,parentId:3}]},
    manifest:{schemaVersion:'1.0.0'},version:{creator_data_version:1}};
  try {
    expect(await archiveAnalytics(root,snapshot)).toBe(true);
    expect(await archiveAnalytics(root,snapshot)).toBe(false);
    expect(await archiveAnalytics(root,{...snapshot,version:{...snapshot.version,lastUpdated:'later'}})).toBe(false);
    const bytes = await readFile(path.join(root,'data/analytics/cf23/1/snapshot.json.gz'));
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(snapshot);
    await expect(archiveAnalytics(root,{...snapshot,fandoms:{...snapshot.fandoms,fandoms:[]}})).rejects.toThrow('version conflict');
  } finally { await rm(root,{recursive:true,force:true}); }
});
