# Create a Print Hive job from your backend

This sample accepts a commerce order, sends a project 3MF to Print Hive, and follows creation until Hive returns a job. It uses the published `@printhive/api@0.2.0` package from npm. A job represents one plate. An order with several plates sends one request per plate.

The CLI and HTTP backend share the same durable order store. Your API key stays on the server. Job creation does not mean a printer has started or finished. Hive retains its readiness, bed-clear, material, and queue checks.

## Current API limit

The [original local proof notes](proof/README.md) record a processing race found during early verification. They are historical evidence, not a statement about the current production deployment. Source inspection can still hold a request for review; partner-supplied plate data does not approve those findings.

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

## Try an order in your browser

With `PRINTHIVE_API_KEY` set privately on the server, run `npm start` and open <http://127.0.0.1:3000/>. The banner shows the destination from `PRINTHIVE_BASE_URL`, which defaults to `https://api.printhiv3d.com`.

**Auto release in production queues a real print.** The form defaults to manual release so you can review the held request before authorizing it.

1. Choose a `.3mf` file, or leave the upload empty to use `fixtures/cube.3mf`.
2. Set the one-based plate number. Add filament requirements with zero-based source slots, material names, and colors.
3. Optionally enter a printer ID. Leave it empty for Smart Queue assignment.
4. Select the release mode and click **Submit order**.
5. Follow the request ID and live status. For a manual hold, review **Required actions**, then click **Release**. Click **Cancel** to stop a request before job creation.

The page polls once per second until `created`, `failed`, or `cancelled`. A held request keeps polling. A created receipt shows its job ID when the job still exists. Network errors leave the outcome unknown, and polling retries. If submission fails, **Retry same order** keeps the original ID and input to avoid a duplicate. Reload to change that input. **Start another order** clears the page without cancelling the previous order.

Uploads use multipart `POST /orders` with an `order` JSON field and a `file` field. The server limits the entire request to 16 MiB, copies the source into the durable order store, and removes its temporary upload directory. JSON requests keep the existing 64 KiB limit. The browser uses only this server's routes and never receives the API key. `GET /config` returns the destination without URL credentials, query strings, or fragments.

![Manual request held for review against the local fake API](proof/ui/manual-held.png)

The [original UI proof](proof/ui/README.md) is historical and uses a loopback stub. The running example uses the configured real API. Tests use local fixtures and do not submit production orders.

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

The tests also cover multipart uploads, request size limits, malformed input, static assets, and sanitized configuration. The original tests cover plate mapping, persisted keys before submission, concurrent retries, restart recovery after a lost response, changed-intent rejection, manual requests, stopped receipts, and polling failure handling.

`proof/run.mjs` drives this application against an already provisioned, owned local Hive API with mock printers. Set `PRINTHIVE_BASE_URL`, `PRINTHIVE_API_KEY`, and `MOCK_PRINTER_ID` privately, then run `npm run proof`. It rejects remote APIs. Provisioning the Hive stack and slicing engine is outside this public sample. Never point the proof runner at real printers. The proof transcript in `proof/local-e2e.log` records only selected response fields and no credentials.

The sample uses only public print-job create, poll, release, and cancel routes. It does not depend on partner source or preparation endpoints.

## License

MIT. See [LICENSE](LICENSE).

## Map Printie plate filaments to Hive requirements

Printie is responsible for processing its project and identifying the source filaments used by each plate. This example consumes that known data. It does not decode painted triangles or infer which palette entries a plate uses.

1. Choose a project 3MF. Changing the file clears the previous plate data and selections.
2. Open **Printie project data**, then paste or import JSON in this shape:

```json
{
  "plates": [
    {
      "number": 2,
      "filaments": [
        { "sourceSlot": 0, "name": "Body", "material": "PETG", "color": "#000000" },
        { "sourceSlot": 3, "name": "Accent", "material": "PETG", "color": "#FFFFFF" }
      ]
    }
  ]
}
```

3. Click **Use project data**. The browser binds the manifest to the selected file's SHA-256; submission verifies those bytes again on the server. The supplied data must describe this file. The bundled cube has its own known plate data.
4. Choose a plate. Its source slots retain their original zero-based indices. Plate switching keeps separate selections; it never renumbers slots or copies another plate's requirements.
5. For every source filament, search the real Hive catalog by name, brand, SKU, or an exact Hive filament UUID. Explicitly choose a result. Use **More results** for the next page. Catalog presence does not establish printer compatibility or loaded inventory.
6. Click **Preview API request** to resolve the selections and inspect the payload without creating a job. Submit only when you want to create an actual request.

The public job API currently accepts `filaments: [{ sourceSlot, material, color, targetSlot? }]`. It does **not** accept material/filament IDs or SKUs in those rows. Selecting a catalog product resolves its material type and hex color into the supported fields. For a new order, the server resolves the ID before submission and keeps the catalog ID, name, and SKU in its durable order record. Unchanged retries reuse that saved catalog snapshot and the original idempotency key, even if the catalog is renamed or unavailable. Hive matches type and color; it does not require that exact product or SKU. A `PETG-CF` type stays `PETG-CF`, and missing or ambiguous colors cannot silently become a guessed color.

The example sends no `targetSlot`. When no printer is specified, Smart Queue determines the physical material routing later. Explicit printer selection retains the same requirement payload and still undergoes Hive's qualification and readiness checks.

SDK 0.2.0 has no catalog methods. The backend therefore uses a thin authenticated read-only adapter for `GET /v1/materials` and `GET /v1/materials/:id`. The browser talks only to the local `/catalog` proxy, which returns selected public catalog fields and never the API key. Search text is limited to 100 characters and paginated in pages of 20. The preview endpoint performs catalog reads only. Existing CLI callers can continue supplying typed filament requirements directly.

The HTTP mapped-order form adds `projectData` and `mappings: [{ sourceSlot, materialId }]` alongside its existing single selected plate. The backend verifies complete mappings, binds the source filename and hash, resolves the selected catalog entries, then calls the SDK with only the supported fields. Original source metadata and chosen catalog records remain part of immutable order intent, so a changed mapping conflicts with the same order ID.

Source knowledge does not bypass inspection. An API hold such as `custom_instructions` or `material_usage_unresolved` remains a hold until Hive supports or completes the required review.
