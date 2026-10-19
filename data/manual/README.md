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
    "fandoms": [],
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
  `offerings`, `assets`, and `links`. `fandoms` defaults to `[]` if omitted. Empty lists and a null thumbnail
  are supported. Spaces must have a nonempty `code` and a string or null `type`.
- Space codes must match map booth identifiers in `cf23-map/data/map.json`.
  This repository does not add geometry to the map.
- Attendance dates must exist in `config/event.json`. Use `[]` if unconfirmed.
  Enter fandom names in `fandoms`; use `[]` when none apply. Numeric `fandomIds`
  belong only in generated public JSON and are rejected in manual input.
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

### Switching to official data while keeping the manual ID

When an exhibitor you entered manually becomes available in the official catalog,
add an explicit mapping in `data/manual/id-mappings.json`:

```json
[
  { "officialId": "7851", "manualId": "1000004" }
]
```

These are example IDs only. Use the official catalog's numeric ID and the manual
ID already used by the app; all IDs in this file are strings. Keep the manual
record with ID `1000004` in `exhibitors.json` as the fallback.

When official ID `7851` is present in the raw snapshot, publication uses **all of
the official record's fields** (name, spaces, attendance, images, links, and fandom
text), but publishes its ID as `1000004`. The manual record is not added a second
time. Manual overrides targeting either ID are ignored while that official record
is present, so old corrections cannot overwrite the official data. The Circle Page
link still points to official ID `7851`, rather than the retained public ID.

If official ID `7851` is absent (including when downloads remain paused and the
official snapshot is empty), the manual record and its overrides at ID `1000004`
are used instead. Favorites, shared lists, and analytics continue using the same
public ID across this transition. Fandom resolution and submissions use the text
from whichever record is active.

Mappings are explicit, with no matching by name or booth number. Manual exhibitors
absent from this mapping file (including
corporate booths and the official shop) continue to be published from
`exhibitors.json`, even when official refreshes are enabled.

Duplicate source IDs, multiple official records targeting one manual ID, missing fallback records,
mapping chains, and output-ID collisions fail the build. Keep mappings permanent
once used. The file starts empty; no mappings are guessed for the current booths.

### Fandom names and directory sync

Add raw fandom names directly to an entry (or an ID-based override):

```json
"fandoms": ["Blue Archive", "Genshin Impact", "A newly announced franchise"]
```

The processor uses the refreshed fandom.directory registry (the source for
`public/v1/fandoms.json`). Canonical names, alternate names, and aliases are matched
with Unicode, whitespace, and case normalization. Known matches become sorted,
deduplicated numeric `fandomIds` in the public catalog; the raw `fandoms` field is
not published. Unknown original strings are submitted to fandom.directory using
the repository's `FANDOM_DIRECTORY_API_KEY`, with deduplication and retries after
failed submissions. Directory-ignored strings are not submitted.

Raw names remain in this manual file. Scheduled fandom sync reprocesses them, so a
new match appears in the public catalog automatically once the directory registry
contains it. You do not need to edit IDs. Submissions are asynchronous; unresolved
strings remain listed in `data/unmapped-fandoms.json` and do not block publication.
Replacing `fandoms` in an override replaces the entire list; `[]` clears it.

`bun run build` performs sync and submissions. `bun run build:manual` is the offline
preview using the cached registry, so it resolves existing matches but does not
fetch the registry or submit unknowns. Neither command downloads the official catalog.

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
latest fandom registry, including unknown-fandom submissions, without downloading
the official catalog. It deploys the full `public/` directory, including image-only
changes. Scheduled official catalog downloads remain paused by the repository
variable `AUTO_REFRESH_ENABLED=false`; scheduled fandom mapping continues. The raw
official catalog currently has no exhibitors, so only the manual additions appear.
Manually dispatching **Full data refresh** would refill the official snapshot.
Editing an input does not
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
