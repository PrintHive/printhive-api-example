# Catalog sync verification

The running example uses the real production API and a locally packed build of the merged SDK. No fake API runs behind the user's example.

## Results

Verified on November 1, 2026, with Node 24.18.0 and locally packed `@printhive/api@0.3.0` from Hive commit `e76e7b9eeeaf02c4907b13c70201c09fa31b3d1d`. The tarball SHA-256 is `dbf86de3ce92cd0cac11994d73cc9fd2730b0e953dd768572c45a27dfb7c8fd3`.

The merged SDK's normal build and OpenAPI drift check passed. Its tests passed with 55 successes and one existing opt-in skip. The example passed all 40 tests. Independent Sol review approved the implementation without findings.

| Surface | API or method | Observed result |
| --- | --- | --- |
| Production example | `GET /config` | SDK 0.3.0, local package, catalog capability available, production destination |
| Production SDK list | `filamentCatalog.list({limit: 1, offset: 0})` → `GET /v1/filament-catalog` | 200, `materials: []`, `total: 0` |
| Production SDK get | `filamentCatalog.get(missingUuid)` → `GET /v1/filament-catalog/{id}` | 404, sanitized error |
| Production desktop and phone | Local import and `POST /catalog-sync/preview` | Invalid imports rejected; valid records show external ID, SKU, material and color swatch; no upstream writes |
| Owned HTTP contract fixture | `filamentCatalog.upsert(record)` → `POST /v1/filament-catalog` | Real SDK sends JSON and the encoded external ID as Idempotency-Key; identical replay after a lost response |
| Owned HTTP contract fixture | Upsert, list with external ID and SKU, get by UUID | Update retains UUID; special characters preserved; partial 422 sanitized; retry sends only failed record |
| Owned capability fixture | Missing SDK catalog methods | Sync and read controls disabled; no REST fallback |

[contract.log](contract.log) records the SDK contract assertions. Those assertions use a controlled HTTP fixture, not Supabase persistence. The fixture does not establish API authorization, tenant isolation or durable write behavior. Production list and get calls used the existing server-side credential; no credential appears in these artifacts.

## UI demos

Local videos are ignored by Git and remain available in this checkout:

- [Production desktop](production-desktop.webm), 1280 × 900, 19.84 seconds.
- [Production phone](production-mobile.webm), 390 × 844, 19.88 seconds.
- [SDK contract fixture](contract-desktop.webm), 1280 × 900, 22.92 seconds. The subtitle identifies the fixture throughout.
- [Capability unavailable](capability-unavailable.webm), 390 × 844, 2.88 seconds.

Discovery and rehearsal preceded recording. All exported durations were decoded and visually reviewed as 5 fps filmstrips, including their final segments. There were no browser errors, request-policy violations or horizontal overflow at either viewport. The production browser guard permitted GET and HEAD plus the local validation-preview POST. It blocked catalog sync and all order mutations.

## Repeat the checks

Install the locally packed SDK as described in the main README, then run:

```sh
npm test
node proof/catalog-sync/contract.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/catalog-sync/run.mjs rehearse
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/catalog-sync/run.mjs record
```

The UI runner expects the owned production-connected example at `http://127.0.0.1:3077`, SDK 0.3.0 and an empty synced catalog. `EXAMPLE_URL` can point to another owned loopback example. It creates and closes separate loopback contract fixtures without modifying that running example. Playwright is verification tooling, not a runtime dependency.

## Remaining proof

No production upsert, order submission, release, cancellation, queue assignment or printer execution was performed. Docker was unresponsive, so a fresh owned Supabase write/read proof was unavailable. Real database persistence and cross-organization rejection remain unproven by this change.

Exact catalog identity in print-job Material Requirements remains separate integration work. Catalog sync does not make the current type-and-color job payload enforce a particular product or SKU. This standalone repository has no remote or configured commit hook; the change is a local commit, with no PR or publication.
