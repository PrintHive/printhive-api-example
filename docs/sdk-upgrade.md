# SDK calls used by this sample

The manifest and lockfile pin the published npm registry package `@printhive/api@0.4.0`. The Node backend owns every SDK call. The browser receives no API credential. No local SDK build or HTTP search fallback is required.

| UI operation | Backend call | Result |
| --- | --- | --- |
| Inspect a 3MF | Local metadata inspection | Filename, SHA-256, plates, previews, and source slots |
| Search filaments | `client.filaments.search({ query, limit, offset })` | Catalog rows with `filamentId` and `acceptedByCreate` |
| Search printers | `client.printers.search({ query, limit, offset })` | Organization printer IDs, names, models, and pagination |
| Resolve a selected catalog ID | `client.filamentCatalog.get(id)` | Organization-owned catalog material snapshot |
| Submit selected plates | `client.printJobs.create` once per plate | Separate creation request IDs |
| Read preparation | `client.printJobs.getCreateRequest(requestId)` | Preparing, held, failed, cancelled, or created receipt |
| Release or cancel | Server-only HTTP helper | Updated receipt; the SDK has no helper |
| Follow a created job | `client.printJobs.get(jobId)` | Live job state and unmet filament requirements |
| CLI wait | `client.printJobs.waitUntilCreated(requestId)` | Created receipt or `PrintJobCreateStoppedError` |
| Sync catalog | `client.filamentCatalog.upsert`, `.list`, `.get` | Organization catalog bindings |

## Search contract

SDK 0.4.0 uses `GET /v1/printers/search` and `GET /v1/filaments/search`. Both methods accept `{ query, limit?, offset?, signal? }` and use the SDK's authenticated transport, retries, and response validation. The sample adapter adds only input bounds and UI field projection. It does not implement matching or ranking.

Example queries are `black PETG`, `bambu red`, and `Boo P1S`. Filament results retain the API's `hasMore` and `matchMode`. A broadened response is labeled in the UI. Printer pagination uses the returned total.

`src/catalog.mjs` resolves selected IDs through the SDK's organization catalog resource. Exact UUID search queries go through `filaments.search` like other text. There is no special `/v1/materials` HTTP lookup, legacy search route, or missing-method fallback.

## Filament creation eligibility

`acceptedByCreate` is the API's catalog-admission flag. The UI disables results with a false flag and explains that creation needs a synced organization catalog filament. A true flag does not establish file, printer, material-loading, readiness, or dispatch eligibility.

In 0.4.0, global rows and unsynced organization rows can appear in search but cannot be used as `filaments[].filamentId`. Global acceptance is pending in 0.4.1 under [Hive PR #5094](https://github.com/PrintHive/hive/pull/5094). This sample neither enables that unreleased behavior nor substitutes material/color-only input to bypass the catalog identity restriction.

New mapped requests include `sourceSlot`, `filamentId`, the matching material/color snapshot, and an optional per-plate `targetSlot`. Hive checks any explicit material and color against the selected catalog row. The sample stores resolved requirements and keys before sending. A retry retains those fields even if the catalog changes or becomes unavailable. Existing saved requests without `filamentId` keep their original payload shape.

## Shared source assignments

The browser can copy a material assignment to currently selected plates with the same source slot and normalized original material/color. Display names do not define identity. Different source slots remain independent even when their colors match. The copy never changes inclusion, confirms usage, or copies a physical placement hint. A later individual choice changes only that plate. The outgoing `plateMappings` still contains one explicit group per plate.
