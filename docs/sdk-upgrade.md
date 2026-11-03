# SDK calls used by this sample

The committed dependency is the npm registry package `@printhive/api@0.3.2`. The Node backend owns every SDK call. The browser receives no credentials.

| UI operation | Backend call | Result |
| --- | --- | --- |
| Choose a 3MF and confirm plate usage | Local metadata inspection, no SDK call | Filename, SHA-256, plates, and source slots |
| Search filaments | `client.filaments.search({ query, limit, offset })` when available | Catalog results with `filamentId`, pagination, and match mode |
| Search printers | `client.printers.search({ query, limit, offset })` when available | Printer IDs, names, models, and pagination |
| Preview mappings | Catalog item read | Material and color for each selected catalog ID |
| Submit order | `client.printJobs.create({ file, filename, plate, filaments, release, idempotencyKey, ... })` | Creation request ID |
| Poll preparation | `client.printJobs.getCreateRequest(requestId)` | Preparing, held, failed, cancelled, or created receipt |
| Release or cancel | Server HTTP helper | Updated receipt; 0.3.2 has no SDK helper |
| Follow created job | `client.printJobs.get(jobId)` | Live job state and unmet filament requirements |
| CLI wait | `client.printJobs.waitUntilCreated(requestId)` | Created receipt or `PrintJobCreateStoppedError` |
| Sync catalog | `client.filamentCatalog.upsert`, `.list`, `.get` | Organization catalog bindings |

## Pending search release

[Hive PR #5039](https://github.com/PrintHive/hive/pull/5039), inspected at `23039ac3ac548af498fc6065aad068c004716fb4`, adds both search methods. The minor release waits on Jerrod's approval. The adapter detects methods on the installed client; changing the dependency after publication activates them.

`SearchOptions` contains `query`, optional `limit`, optional `offset`, and optional `signal`. `PrinterSearchPage` contains `printers`, `total`, `query`, and `processingTimeMs`. `FilamentSearchPage` contains `filaments`, `total`, `hasMore`, `matchMode`, and `originalQuery`.

`src/search.mjs` normalizes `filamentId` to the sample's catalog `id` at the boundary. It preserves Hive's filament pagination and reports broadened matching. Printer results retain their printer ID.

On 0.3.2, filament search retains `GET /v1/materials?q=...` as a labeled legacy fallback. Printer search returns a clear unavailable response; direct ID entry and Smart Queue remain available. No fallback invents results. `filamentCatalog.list` only lists synced organization records and cannot replace app search.

The item read remains `GET /v1/materials/{id}` because SDK catalog get covers organization-synced bindings rather than the full global catalog. Release and cancel also remain server-only HTTP helpers. These gaps are explicit in the UI.

## Catalog identity and create input

The search result's `filamentId` is the catalog UUID, not a source slot or physical spool. The sample preserves it in `catalogSelections[].id` and `mappings[].materialId`.

At the inspected PR head, the multipart create schema still has `additionalProperties: false` and permits only `sourceSlot`, `material`, `color`, and optional `targetSlot` per filament. It requires the first three fields. Therefore the sample reads the selected catalog row and sends material and color. Sending `filaments[].filamentId` requires a separate create API and SDK contract change.

The sample saves resolved requirements before the outbound create call. Replays use saved source bytes, requirements, and keys even when the catalog changes or becomes unavailable.
