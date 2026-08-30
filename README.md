# CF23 catalog data

This repository maps the stored Comifuro catalog snapshot to canonical fandom IDs from [fandom.directory](https://fandom.directory/api/docs.md).

## Public API (GitHub Pages)

Check `last-updated.json` first. Its managed `creator_data_version` increments only when the semantic catalog or exported fandom data changes; fresh-download timestamps and ETags alone do not increment it. Its managed ISO `lastUpdated` records any published payload change. Other keys, such as the app version and release message, are preserved as manually managed values. Then use `manifest.json`; all paths in it are relative to the Pages site root. The API exposes:

- `v1/fandoms.json`: the global canonical fandom list, including `parentId` and `alternateNames` for search/autocomplete.
- `v1/catalog.json`: event metadata and exhibitors using fandom IDs.

The event-independent shape deliberately scopes exhibitor IDs and space/day information to the event. The generic mapper in `scripts/lib/map-event.ts` owns fandom resolution, while `scripts/adapters/comifuro.ts` translates this catalog's fields. A future event can keep the public schema and mapping logic, replace the event config and source adapter, and use the same stable paths. `config/event.json` holds source-specific event and attendance mapping rather than baking it into the mapper.

## Build inputs and diagnostics

- `data/raw/catalog.json` is the immutable input snapshot used by scheduled runs.
- `data/raw/fandom-directory.json` stores the complete raw registry response; `data/raw/fandom-directory.meta.json` stores its ETag and Last-Modified metadata.
- `data/unmapped-fandoms.json` reports unresolved source fields for auditing and is not published.

Two staggered callers invoke the shared `_refresh-data.yml` workflow with a single `download_catalog` option. `Full data refresh` passes `true` every six hours at `00:23`, `06:23`, `12:23`, and `18:23` UTC. Each run downloads the catalog, refreshes fandom.directory (with cache fallback), maps the catalog, submits new unknown original fields, commits changes, and deploys Pages. `Refresh fandom mapping` passes `false` exactly one hour later at `01:23`, `07:23`, `13:23`, and `19:23` UTC, repeating every step against the stored raw catalog snapshot.

## GitHub setup

Add the repository secret `FANDOM_DIRECTORY_API_KEY` using an API key issued by the fandom.directory administrator. Submission is best-effort: a missing key, timeout, or API failure emits a warning but never blocks catalog publication. Successfully queued fields are recorded in `data/raw/fandom-submissions.json` so they are not submitted repeatedly. The workflow does not poll or wait for directory processing.

The committed fandom registry is a required resilience cache. Registry timeouts, non-success responses, and invalid responses fall back to it, allowing catalog updates and Pages deployment to continue while fandom.directory is unavailable. Ensure GitHub Actions has read/write workflow permissions so its bot can commit outputs.

The catalog downloader discovers the catalog's public Supabase connection from the deployed frontend, so no catalog credential needs to be configured or committed.

Run locally with Bun 1.3 or newer:

```sh
bun install
bun run typecheck
bun test
bun run build
```
