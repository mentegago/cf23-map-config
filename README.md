# CF23 catalog data

This repository maps the stored Comifuro catalog snapshot to canonical fandom IDs from [fandom.directory](https://fandom.directory/api/docs.md).

## Public API (GitHub Pages)

Check `last-updated.json` first. Its managed `creator_data_version` increments only when the semantic catalog or exported fandom data changes; fresh-download timestamps and ETags alone do not increment it. Its managed ISO `lastUpdated` advances only with a new `creator_data_version` (or is initialized on first publication). Other keys, such as the app version and release message, are preserved as manually managed values. The complete global fandom list is exported, so changes to that list count as data updates even if no exhibitor changes. Then use `manifest.json`; all paths in it are relative to the Pages site root. The API exposes:

- `v1/fandoms.json`: the global canonical fandom list, including `parentId` and `alternateNames` for search/autocomplete.
- `v1/catalog.json`: event metadata and exhibitors using fandom IDs. Each exhibitor's `attendanceDates` is an array of ISO calendar dates (`YYYY-MM-DD`). Those dates match `event.days[].id`; `event.days[].label` is a human-readable weekday name.

### Creator icons

Catalog processing generates optional `assets.icon` URLs for list avatars. The
original circle cut stays in `assets.thumbnail`. Icons are auto-oriented,
center-cropped to 80×80, and encoded as WebP at quality 75 with Sharp. Generated
files live in `public/images/icons/` with SHA-256 content hashes as filenames.
Identical output images share a file.

`data/raw/creator-icons.json` records source digests and HTTP validators. Each
refresh conditionally revalidates remote images; unchanged bytes skip conversion.
Manual images hosted under `PUBLIC_BASE_URL` are read from `public/` directly.
Downloads run six at a time with a timeout. Missing or corrupt sources do not
block publication: an existing icon for the same source is retained, otherwise
the optional field is omitted and clients can show a fallback. Old image files
are retained for clients using cached catalogs. No image URL replaces the full
circle cut or gallery assets, and no client storage migration is needed.

The `map` entry in `manifest.json` has an independent increasing
`version` and a `path` pointing to an immutable `maps/*.json` snapshot. Each
snapshot contains its `version`, `layout`, and derived `proximity` data. The app
checks the manifest in the background and caches the complete snapshot offline.
The source map, distance generator, and publisher are owned entirely by this
repository. No app checkout is required.

## Updating the map

1. Replace or edit `data/map.json` (Event Canvas semantic map schema v2, or a
   legacy grid).
2. Commit and push that file to `master`.
3. **Publish map data** automatically calculates booth distances, writes a
   versioned snapshot and manifest, commits the generated files, and deploys
   Pages. You can also run the workflow manually from Actions.

For a local preview of the publication, run Python 3.10 or newer:

```sh
python scripts/publish_map_data.py
python -m unittest discover -s scripts -p '*_test.py'
```

`bun run build:map` runs the same publisher, and `bun run build` includes it in
the full data build. Only `data/map.json` is maintained by hand; proximity is
generated automatically. Unchanged data keeps its version. Older snapshots are
retained for in-flight clients. To roll back, restore an older source map and
push it; publication assigns a new version.

CF23 Map loads its bundled fallback, downloads newer complete snapshots in the
background, and caches them for offline use. Updating its bundled fallback for
a later app release is an optional download from this API.

The event-independent shape deliberately scopes exhibitor IDs, spaces, and attendance dates to the event. The generic mapper in `scripts/lib/map-event.ts` owns fandom resolution, while `scripts/adapters/comifuro.ts` translates this catalog's fields. A future event can keep the public schema and mapping logic, replace the event config and source adapter, and use the same stable paths. `config/event.json` defines the event days and maps source attendance labels (for Comifuro: `Both Days`, `Saturday only`, `Sunday only`, `SAT`, `SUN`) onto those ISO dates rather than baking the mapping into the adapter.

## Build inputs and diagnostics

Manual corporate, food, and other exhibitors can be maintained in
`data/manual/exhibitors.json`, with ID-based corrections in
`data/manual/overrides.json` and images in `public/images/exhibitors/`.
The build merges them into the regular catalog and publishes absolute image URLs
using the `PUBLIC_BASE_URL` environment variable. In GitHub, set the Actions
repository variable `PUBLIC_BASE_URL` to `https://cf23-config.nnt.gg/`. See the
[manual data guide](data/manual/README.md) for the format and publication workflow.

Manual entries accept `"fandoms": ["Blue Archive", "Genshin Impact"]` instead of
numeric IDs. Processing resolves canonical names and aliases from the directory
registry, emits `fandomIds` in the public catalog, and submits unknown names to
fandom.directory. Scheduled fandom sync repeats that resolution as new matches
become available. Raw manual names remain intact for future syncs.

`data/manual/id-mappings.json` can map an official ID to a previously published
manual ID. When that official record is available, it supplies all exhibitor data
while the public ID remains stable for favorites and shared lists. The manual
record remains the fallback when the official record is absent. See the manual
guide for precedence, validation, and an example.

- `data/raw/catalog.json` is the input snapshot used by scheduled fandom mapping.
  It currently contains zero official exhibitors; only the manually added exhibitors
  are published. Downloads with identical content preserve the existing snapshot
  and its `downloadedAt` timestamp.
- `data/raw/fandom-directory.json` stores the complete raw registry response; `data/raw/fandom-directory.meta.json` stores its ETag and Last-Modified metadata.
- `data/unmapped-fandoms.json` reports unresolved source fields for auditing and is not published.

Runs with no file changes create no commit, and Pages deployment is skipped when the public files are unchanged.

**Official catalog downloads are temporarily paused; fandom sync remains active.**
The **Full data refresh** schedule requires the Actions repository variable
`AUTO_REFRESH_ENABLED=true`; it is currently `false`. **Refresh fandom mapping**
continues on its existing schedule, including registry sync and unknown-field
submissions. A manual dispatch of **Full data refresh** explicitly downloads the
official catalog again, so avoid it while maintaining the empty official snapshot.

For now, maintain new exhibitors in `data/manual/exhibitors.json` and corrections
to existing IDs in `data/manual/overrides.json`. Pushing those files or images to
`master` runs **Publish manual exhibitors**. This uses the stored official catalog
(currently empty), refreshes the fandom registry, and submits unknown fields. It
does not download the official catalog. Versioning, validation, and Pages
publication still run normally. Map publication remains available independently.

Two staggered callers invoke the shared `_refresh-data.yml` workflow. When enabled,
`Full data refresh` downloads the catalog every six hours at `00:23`, `06:23`,
`12:23`, and `18:23` UTC. `Refresh fandom mapping` runs exactly one hour later at
`01:23`, `07:23`, `13:23`, and `19:23` UTC against the stored catalog. Both refresh
the fandom registry, map data, submit unknown fields, and publish actual changes.

## GitHub setup

To change app release metadata, open **Actions → Update app release → Run workflow** on `master`. Enter `current_version` (a non-negative integer), `release_notes`, or both. Empty or whitespace-only inputs preserve the existing field. This workflow only changes those two fields in `public/last-updated.json`; `creator_data_version` and `lastUpdated` stay unchanged. It commits and deploys actual changes, and skips both when the values are unchanged. It shares the data refresh workflows' publication queue to avoid overlapping publishes.

Add the repository secret `FANDOM_DIRECTORY_API_KEY` using an API key issued by the fandom.directory administrator. Submission is best-effort: a missing key, timeout, or API failure emits a warning but never blocks catalog publication. Successfully queued fields are recorded in `data/raw/fandom-submissions.json` so they are not submitted repeatedly. The workflow does not poll or wait for directory processing.

The committed fandom registry is a required resilience cache. Registry timeouts, non-success responses, and invalid responses fall back to it, allowing catalog updates and Pages deployment to continue while fandom.directory is unavailable. Ensure GitHub Actions has read/write workflow permissions so its bot can commit outputs.

The catalog downloader discovers the catalog's public Supabase connection from the deployed frontend, so no catalog credential needs to be configured or committed.

Run locally with Bun 1.3 or newer and Python 3.10 or newer:

```sh
bun install
bun run typecheck
bun test
export PUBLIC_BASE_URL=https://cf23-config.nnt.gg/
bun run build:manual
```

`build:manual` processes committed inputs with `REFRESH_FANDOMS=false`. Use
`bun run build` when you explicitly want to refresh the fandom registry as well;
the official catalog is downloaded only by `bun run snapshot:catalog` or the
**Full data refresh** workflow.
