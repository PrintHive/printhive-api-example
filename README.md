# Create a Print Hive job from your backend

This sample accepts a commerce order, sends a project 3MF to Print Hive, and follows creation until Hive returns a job. It uses the published `@printhive/api@0.2.0` package from npm. A job represents one plate. An order with several plates sends one request per plate.

The CLI and HTTP backend share the same durable order store. Your API key stays on the server. Job creation does not mean a printer has started or finished. Hive retains its readiness, bed-clear, material, and queue checks.

## Current API limit

Local verification found a timing defect: creation can fail with `model_file_not_ready` while its newly sliced output is still processing. Do not claim reliable production use until the API resolves that race. [The proof notes](proof/README.md) describe the evidence and verification conditions.

## Set up

1. Install Node.js 20 or later.
2. Create a Print Hive account and an organization. Add a qualified printer to your organization before submitting work.
3. Create an organization API key with **Control** scope. Control includes read access and also permits raw G-code, stopping printers, and temperature changes across the organization. Protect this key accordingly. Never choose **Dangerous** for this sample.
4. Install the dependencies:

   ```sh
   npm ci
   npm ls @printhive/api
   ```

   Expect `@printhive/api@0.2.0`. The lockfile resolves the npm registry tarball, with no workspace links.

5. Set `PRINTHIVE_API_KEY` privately in your shell or server environment. Do not commit it or put it in browser code. Optionally set `PRINTHIVE_BASE_URL` to your own development API. The default is the SDK's public API. HTTP is accepted only for loopback development.

The included `fixtures/cube.3mf` is a synthetic, single-plate PETG project for a P1S with a 0.4 mm nozzle. It is adapted from a synthetic fixture and a Bambu Studio round-trip used to retain stable object identities. It contains a small mesh and slicing settings, with no customer model or printer credentials. Treat it as an integration fixture, not a qualified production part.

## Send an order from the CLI

Inspect `fixtures/order.json`, then run:

```sh
npm run send-print -- fixtures/order.json
```

The first output is the accepted creation receipt with a `requestId`. Polling ends with a receipt such as:

```json
{
  "requestId": "…",
  "status": "created",
  "job": { "id": 123, "printer_id": null }
}
```

The actual receipt contains additional fields. A null printer means Smart Queue owns later assignment. To pin the job, add `printer_id` with a printer UUID to the order. The target must belong to your organization.

To order several plates, set `plates` to their one-based numbers, such as `[1, 2]`, and use a project that contains those plates. Filament `sourceSlot` values are zero-based. Each entry supplies `material` and a `#RRGGBB` color. This small example applies the same filament requirements to every requested plate. Split an order into separate order IDs when plates need different mappings.

Run the same command after a network failure or restart. The store retains one key per plate before the first outbound call. It also keeps a private copy of the source bytes. Submitted plates retain their request IDs. A retry of an incomplete submission uses the stored key. Changed bytes, plate selection, release policy, filename, or printer under the same order ID fail locally. Use a new order ID for changed intent.

`data/` contains the store and source copies. Keep this directory across restarts. Run exactly one backend process per store directory. For a production deployment, replace it with a transactional database with unique order/plate keys and serialized writes. Add retention and backups for the source files.

## Run the backend

```sh
npm start
curl --fail-with-body http://127.0.0.1:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"id":"http-order-1001","file":"cube.3mf","plates":[1],"filaments":[{"sourceSlot":0,"material":"PETG","color":"#39FF14"}]}'
curl --fail-with-body http://127.0.0.1:3000/orders/http-order-1001
```

`POST /orders` returns HTTP 202 with the order ID and the creation request IDs. `GET /orders/{id}` returns the current receipt for each plate, including required actions and API errors. Source filenames resolve under `DESIGN_DIR`, which defaults to `fixtures`. Provision trusted project files there on the server. The CLI instead accepts a server filesystem path in its order JSON.

The server binds to loopback and has no customer authentication. Before exposing it, add your own authentication, order authorization, request limits, and a trusted design catalog. Do not accept arbitrary filesystem paths from customers. `PORT`, `ORDER_DATA_DIR`, and `DESIGN_DIR` configure the local sample.

## Authorize or cancel a manual request

Set `release` to `"manual"` in a new order. The request prepares the plate and then reaches `held` with `requiredActions`. The CLI prints that receipt and exits with code 2.

```sh
npm run send-print -- release REQUEST_ID
npm run send-print -- status ORDER_ID
npm run send-print -- cancel ANOTHER_REQUEST_ID
```

The backend exposes `POST /orders/{id}/{plate}/release` and `POST /orders/{id}/{plate}/cancel` for the same operations. These call HTTP directly because SDK 0.2.0 has no release or cancel helper. They require Control scope. Read the status after a lost control response before deciding whether to repeat the action. The wrapper does not automatically retry control calls.

Release authorizes only a manual hold. It cannot approve an unrelated preparation hold. Cancel works before job creation. Once a job exists, use Hive's job cancellation workflow instead.

## Handle stopped or unsettled work

`waitForJob` calls `printJobs.waitUntilCreated` and catches `PrintJobCreateStoppedError`. It returns the stopped receipt without authorizing work.

- `held`: present `requiredActions` for operator review. For unresolved preparation holds, cancel and submit corrected input with a new order ID.
- `failed`: inspect `error`, correct the input or configuration, and submit a new order.
- `cancelled`: stop processing this request.
- `created`: save the job ID. A retained receipt can have `job: null` if the job was deleted.

A timeout or network error leaves the outcome unknown. Query the stored request ID or retry the unchanged order. The CLI exits with code 1 for these failures. The SDK retries eligible transient failures with the same key. An idempotency conflict means the same key reached Hive with different intent or bytes. Do not resolve it by silently generating a new key.

A filament mismatch ordinarily creates a job with filament waiting reasons rather than a pre-job `held` receipt. A created job may still wait for materials or readiness.

## Verify

```sh
npm test
```

The tests cover plate mapping, persisted keys before submission, concurrent retries, restart recovery after a lost response, changed-intent rejection, manual requests, stopped receipts, and polling failure handling.

`proof/run.mjs` drives this application against an already provisioned, owned local Hive API with mock printers. Set `PRINTHIVE_BASE_URL`, `PRINTHIVE_API_KEY`, and `MOCK_PRINTER_ID` privately, then run `npm run proof`. It rejects remote APIs. Provisioning the Hive stack and slicing engine is outside this public sample. Never point the proof runner at real printers. The proof transcript in `proof/local-e2e.log` records only selected response fields and no credentials.

The sample uses only public print-job create, poll, release, and cancel routes. It does not depend on partner source or preparation endpoints.

## License

MIT. See [LICENSE](LICENSE).
