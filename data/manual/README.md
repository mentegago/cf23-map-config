# Manual exhibitors and catalog corrections

Edit `exhibitors.json` to add exhibitors missing from the source catalog. Edit
`overrides.json` to correct an existing exhibitor by ID, including ordinary creator
booths. Both files are JSON arrays. Never edit the downloaded snapshot or generated public catalog
to maintain manual data.

The build maps the source catalog, appends manual exhibitors, applies overrides,
validates changed records, and resolves local image paths before calculating stats,
the semantic data version, and analytics archives. The app consumes the resulting
`public/v1/catalog.json` as one ordinary catalog. No app-side merging is needed.

## Add an exhibitor

Put images in `public/images/exhibitors/<slug>/`. This example uses placeholder
information; replace it with confirmed details and add the referenced image files
before building:

```json
[
  {
    "id": "1000001",
    "name": "Example Brand",
    "category": "corporate",
    "spaces": [{ "code": "CORP-01", "type": "corporate" }],
    "attendanceDates": ["2026-10-31", "2026-11-01"],
    "contentRating": null,
    "fandomIds": [],
    "offerings": ["goods"],
    "assets": {
      "thumbnail": "images/exhibitors/example-brand/logo.webp",
      "gallery": ["images/exhibitors/example-brand/announcement.webp"]
    },
    "links": [{ "type": "instagram", "url": "https://www.instagram.com/example/" }],
    "sourceUrls": ["https://www.instagram.com/p/EXAMPLE/"]
  }
]
```

- Assign a permanent numeric string ID from **1000000 through 1999999**. Do not
  reuse IDs or derive them from the booth code, name, or position in this file.
  Duplicate IDs, including collisions with the source catalog, fail the build.
- Required fields are `id`, `name`, `spaces`, `attendanceDates`, `contentRating`,
  `fandomIds`, `offerings`, `assets`, and `links`. Empty lists and a null thumbnail
  are supported. Spaces must have a nonempty `code` and a string or null `type`.
- Space codes must match map booth identifiers in `cf23-map/data/map.json`.
  This repository does not add geometry to the map.
- Attendance dates must exist in `config/event.json`. Use `[]` if unconfirmed.
  Fandom IDs must exist in the fandom registry; use `[]` when none apply.
- Optional `category` is descriptive metadata (for example `food` or `corporate`).
  Optional `sourceUrls` records announcement evidence. Both are ignored by the app.
- Optional `catalogUrl` defaults to explicit `null` for additions. The app hides
  the Circle Page button in that case. Set an absolute HTTP(S) URL only when a
  real catalog page exists. Other social and website links go in `links`.

## Override an exhibitor

`overrides.json` uses the same field names but only requires an existing ID:

```json
[
  {
    "id": "123",
    "name": "Corrected exhibitor name",
    "assets": {
      "thumbnail": "images/exhibitors/example-brand/logo.webp",
      "gallery": []
    },
    "sourceUrls": ["https://example.com/official-announcement"]
  }
]
```

Overrides apply after additions, so either upstream or manual IDs can be targeted.
Missing targets, repeated override IDs, and unknown top-level fields fail the build.
Omitted fields preserve the original value. Supplied arrays and objects replace the
entire field, including `assets`; provide both `thumbnail` and `gallery` when
overriding assets. Use `null` to clear nullable fields and `[]` to clear lists.

## Images and publication

Set the GitHub Actions **repository variable** `PUBLIC_BASE_URL` to
`https://cf23-config.nnt.gg/` under **Settings → Secrets and variables → Actions →
Variables**. This is public configuration, so it does not need to be a secret.
All refresh workflows pass it into the build as an environment variable.
Every repo-relative image path becomes a full URL in
the generated catalog, for example:

```text
https://cf23-config.nnt.gg/images/exhibitors/example-brand/logo.webp
```

The variable is required; missing or invalid values fail the build before publishing.
The base URL must end with `/` (a Pages project subpath is supported). Existing
absolute HTTP(S) image URLs are preserved. Local paths must start with `images/`,
use simple filename characters, and point to existing files within `public/images/`.
Use a new filename when replacing an image, so cached apps fetch the new asset and
the catalog URL change advances the data version.

On `master`, pushing manual files or public images triggers
**Publish manual exhibitors**. It rebuilds using the stored catalog snapshot and
cached fandom registry (`REFRESH_FANDOMS=false`), with no catalog download, registry
fetch, or unknown-fandom submission. It deploys the full `public/` directory,
including image-only changes. Scheduled full refreshes and fandom remapping are
temporarily paused by the repository variable `AUTO_REFRESH_ENABLED=false`.
Set it to `true` to resume schedules; manually dispatching a refresh still works
and explicitly opts into fetching upstream data. Editing an input does not
directly edit the generated catalog; processing and deployment must succeed first.
The existing refresh or manual publication workflow can also be dispatched by hand.
Changing the GitHub variable does not start a workflow; dispatch **Publish manual
exhibitors** after changing it to regenerate the catalog URLs and deploy.

Local validation and processing:

```sh
bun run typecheck
bun test
export PUBLIC_BASE_URL=https://cf23-config.nnt.gg/
bun run build:manual
```

For a creator already in the catalog, keep its existing ID in `overrides.json` so
favorites and shared links continue to work. Replace the full `spaces` array to
correct booth assignments, the full `attendanceDates` array to correct attendance,
or the full `assets` object to replace thumbnail and gallery. Add new exhibitors
to `exhibitors.json` using the reserved manual ID range. Record announcement links
in `sourceUrls`. All manual records continue to take precedence if upstream
refreshes are resumed later.

In PowerShell, set `$env:PUBLIC_BASE_URL = 'https://cf23-config.nnt.gg/'` instead of
the `export` command. Bun also supports a local, git-ignored `.env` file containing
`PUBLIC_BASE_URL=https://cf23-config.nnt.gg/`.

After publication, refresh the app's bundled fallback when desired:

```sh
python tools/fetch_creator_data.py --source <path-to-cf23-data>/public
```

Run that last command from the `cf23-map` checkout. Remote catalog updates work
without rebuilding the app; updated bundled JSON is needed for a fresh offline
installation to include the new exhibitors. Repo-hosted images remain network
assets, like the existing catalog images.
