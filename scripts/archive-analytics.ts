import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { archiveAnalytics, type AnalyticsSnapshot } from './lib/analytics-archive.ts';

const root = process.cwd();
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const bundle = process.argv.indexOf('--bundle');
if (bundle >= 0) {
  const folder = path.resolve(process.argv[bundle + 1]!);
  await archiveAnalytics(root, {catalog: await read(path.join(folder,'catalog-initial.json')),
    fandoms: await read(path.join(folder,'fandoms-initial.json')),
    version: await read(path.join(folder,'last-updated-initial.json')),
    manifest: {schemaVersion:'1.0.0',event:(await read(path.join(folder,'catalog-initial.json'))).event && {
      id:(await read(path.join(folder,'catalog-initial.json'))).event.id,
      name:(await read(path.join(folder,'catalog-initial.json'))).event.name},
      catalog:'v1/catalog.json',fandomRegistry:'v1/fandoms.json'}});
} else {
  await archiveAnalytics(root, {catalog: await read('public/v1/catalog.json'), fandoms: await read('public/v1/fandoms.json'),
    manifest: await read('public/manifest.json'), version: await read('public/last-updated.json')});
  if (process.argv.includes('--history')) {
    const commits = execFileSync('git',['log','--format=%H','--','public/last-updated.json'],{encoding:'utf8'}).trim().split(/\s+/);
    let recovered = 0, unavailable = 0;
    for (const commit of commits) {
      let snapshot: AnalyticsSnapshot;
      try {
        const show = (file: string) => JSON.parse(execFileSync('git',['show',`${commit}:${file}`],
          {encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']}));
        snapshot = {catalog:show('public/v1/catalog.json'),fandoms:show('public/v1/fandoms.json'),
          manifest:show('public/manifest.json'),version:show('public/last-updated.json')};
      } catch { unavailable++; continue; }
      if (!snapshot.catalog.event?.id || !Array.isArray(snapshot.catalog.exhibitors) ||
          !Array.isArray(snapshot.fandoms.fandoms) || !Number.isSafeInteger(snapshot.version.creator_data_version)) {
        unavailable++; continue;
      }
      if (await archiveAnalytics(root,snapshot)) recovered++;
    }
    console.log(JSON.stringify({recovered,unavailable}));
  }
}
