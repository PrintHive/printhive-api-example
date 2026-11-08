# Slice a 3MF and create a Print Hive job

We'll run a React app with a Node backend, select plates from a project 3MF, and submit it for cloud slicing. The backend uses `@printhive/api@0.6.0`. Each plate creates one request and, after preparation and release, one job.

The sample defaults to **Manual · review first**, so you can inspect a held request before authorizing it. **Automatic · start real prints when ready** is an explicit choice. It requires a confirmation naming the printer or Smart Queue and starts real prints on your farm.

For development, use an owned local Hive API with mock printers. The [fake API demo](proof/selected-plates/README.md) needs no Hive credential or printer.

## 1. Run the sample

Clone the sample and install its dependencies with Node.js 20.19 or later:

```sh
git clone https://github.com/PrintHive/printhive-api-example.git
cd printhive-api-example
npm ci
npm ls @printhive/api
```

Expect `@printhive/api@0.6.0`. Set the destination and an organization API key privately in your server environment:

```sh
export PRINTHIVE_BASE_URL=http://127.0.0.1:YOUR_LOCAL_API_PORT
export PRINTHIVE_API_KEY_FILE=/path/to/your/local-mock.key
npm run dev
```

Replace both placeholders with values from your owned local Hive stack. The key needs Control permission to create, release, or cancel work. Read permission covers search and status. `PRINTHIVE_API_KEY_FILE` is preferred over `PRINTHIVE_API_KEY` when both are set. File contents are trimmed. An unreadable or empty configured file stops startup. Never put the key in client code or commit it. This repo does not provision Hive, its slicing engine, or mock printers.

Open <http://127.0.0.1:5173>. Check the API destination banner. The Node backend listens on 3078; `API_PORT` changes that port. The browser calls the Node backend, which owns the SDK and credentials.

For your production demo, run the same app with your organization key file:

```sh
export PRINTHIVE_BASE_URL=https://api.printhiv3d.com
export PRINTHIVE_API_KEY_FILE=/path/to/your/organization.key
npm run dev
```

Open <http://127.0.0.1:5173> and check the production destination banner. Choosing automatic release, or releasing a manual hold, can start real prints. Keep the key file private.

The backend binds to `127.0.0.1`. It checks Host, Origin, and a random session header on every API call. The browser obtains the session from `/session`, never the Hive key. The dev proxy permits the exact `http://127.0.0.1:5173` origin. Built-app requests use their own origin. The browser renews its session after a backend restart. The active order ID stays in this tab's session storage, so a reload resumes status without resubmitting.

## 2. Choose a project and plates

Leave **Project 3MF** empty to use `fixtures/cube.3mf`. This synthetic project contains a small PETG cube for a P1S with a 0.4 mm nozzle. Choose **Plate 1** and keep **Manual · review first** selected.

For your own project, choose a `.3mf` file. Select **Include plate** on each plate you want to submit. The mapping view shows the union of Source Slots used by selected plates. Review saved usage, then click **Confirm saved usage for selected plates** once. Each selected plate still sends only its own slots.

Click a preview to check or correct that plate's usage. If saved usage is missing or conflicting, select the known source slots and click **Use these source filaments** for that plate. The sample does not decode painted triangles or infer support materials from unsliced projects. Supply known usage in Advanced when saved metadata cannot resolve it. The cards show saved PNG previews from the project. A plate with no usable image shows **No saved preview** and remains selectable. Saved previews and usage metadata can be stale.

This step makes no SDK call. The file upload to Hive happens in `client.printJobs.create` after you submit. Metadata extraction neither slices the file nor clears Hive inspection holds.

## 3. Map filaments and choose a printer

Search for a filament, then select a result with **Use**. Assignments are available as soon as a source is selected, before usage confirmation. The source slot identifies a filament in the project; it does not identify a printer tray.

The search adapter calls the SDK:

```ts
const page = await client.filaments.search({ query: "black PETG", limit: 20, offset: 0 });
const filament = page.filaments.find((row) => row.acceptedByCreate);
if (!filament) throw new Error("No eligible catalog filament found");
const filamentId = filament.filamentId;
```

The UI sends free-text queries through the published SDK. Try `black PETG` or `bambu red`. Choose a result with `acceptedByCreate: true`. Enabled global catalog filaments and synced organization catalog filaments can be selected. See the [catalog search guide](docs/search-catalog.md) if your search has no eligible results.

Under **Choose the destination**, search for a printer such as `Boo P1S`. The backend calls:

```ts
const page = await client.printers.search({ query: "Boo P1S", limit: 20, offset: 0 });
```

Select a printer result, or click **Use Smart Queue** for assignment across your farm. A search result does not establish loaded filament or readiness.

In **Selected plates together**, choose a catalog filament once for each Source Slot. The choice applies to selected plates that use the same original slot, material, and color. Different Source Slots remain separate even when their colors match. Deselecting a plate removes its unused slots from this view and from submission.

For a different choice on one plate, choose **Per-plate overrides**, open that plate, and click **Change requirement**. The existing apply-to-selected action remains available there. Confirm source usage for every selected plate before submission. Click **Preview API request**. Expect a `plates` list with one-based plate numbers, zero-based `sourceSlot` entries, and the selected catalog `filamentId` values. Hive resolves material and color when it accepts each creation request.

## 4. Upload and slice the plate

Keep **Manual · review first** selected, then click **Submit order**. For automatic mode, explicitly select **Automatic · start real prints when ready**. After **Submit order**, review the confirmation's destination and click **Confirm automatic printing** or **Go back**. For automatic mode on a named printer, select it through search so the confirmation shows its name. The backend saves the source bytes and one idempotency key per plate before calling the SDK. In `src/orders.mjs`, `record.source` names that private copy under `ORDER_DATA_DIR`, which defaults to `data/`. The call has this shape:

```ts
const request = await client.printJobs.create({
	file: record.source,
	filename: "cube.3mf",
	plate: 1,
	filaments: [{ sourceSlot: 0, filamentId }],
	release: "manual",
	on_filament_mismatch: "wait",
	idempotencyKey: savedKey,
});
```

Expect a request ID and a `preparing` state. Hive inspects the source, slices the selected plate, and processes the output. Preparation can fail or hold for review. An accepted upload is not a created job.

The browser starts polling this backend's `GET /orders/{id}` during submission, every two seconds. Once a job exists, it polls every five seconds and stops when all plates and jobs are terminal. The backend calls `client.printJobs.getCreateRequest(requestId)` for each plate. When preparation permits manual review, expect `held` and the required action `manual_release_required`.

## 5. Review the hold

Read **Required actions**. In your local mock environment, click **Release** to authorize the manual hold, or **Cancel** to stop before job creation.

The backend calls `client.printJobs.releaseCreateRequest(requestId)` or `client.printJobs.cancelCreateRequest(requestId)`. Release is offered when every reported action is `manual_release_required` or `preparation_lineage_unreadable`. Other holds retain their API codes and details. Release cannot approve unrelated preparation holds. For a complete engine-setting review, compare the reported source and engine values, then use **Approve reported engine settings**. The backend calls SDK 0.6.0's `client.printJobs.approveReview(requestId, review)` with exactly those values. Hive rejects stale approvals. Other preparation holds need review in the Hive app.

## 6. Follow the job

**Selected plate requests** shows all plates together, with slicing/preparation, holds, queued jobs, cancellations, and failures. The summary counts each state. Choose a plate to review its details or control it. One failed upload or poll does not hide its siblings. Network failures, 429, and 5xx responses can be retried with the saved key. Other 4xx rejections are final and retain their API status, code, message, and reasons. Click **New order** once all creation requests settle. After release, expect `created` and a job ID. The backend then reads the live job:

```ts
const receipt = await client.printJobs.getCreateRequest(request.requestId);
if (receipt.status === "created" && receipt.job) {
	const job = await client.printJobs.get(receipt.job.id);
}
```

The UI keeps the creation receipt separate from live job status. A job can wait for material or printer readiness. The waiting panel shows only API-reported requirements and physical placement hints. It never converts a source slot into a tray index.

A created job does not prove a physical print completed. Production dispatch and slicing still depend on Hive inspection, readiness, and loaded material.

The sample uses the published multipart API and its local order store. Hive now also accepts JSON creation with `source_version_id` at `POST /v1/print-jobs/create`, following PR #5185. This sample does not implement that path. Organization-wide request-history recovery remains a follow-up.

## If something goes wrong

Keep the active order open. A reload resumes status in the same tab. **Retry same order** uses the saved server record and keys, including after a backend restart. Avoid creating another order for the same plates while status is unknown. Files up to 150 MiB are accepted; uploads stream to temporary disk, one at a time, with a ten-minute timeout.

To control a request from a terminal, find its `requestId` in `data/<order>.json`, then run one of these commands with the same server environment:

```sh
npm run send-print -- release <requestId>
npm run send-print -- cancel <requestId>
```

Release can start real prints. Once a job exists, cancel it in the Hive app.

For other tasks, use the [CLI and HTTP guide](docs/send-orders.md), [catalog mapping guide](docs/map-filaments.md), [catalog sync guide](docs/sync-catalog.md), or [SDK reference](docs/sdk-upgrade.md). To check your changes, run `npm run verify`.

MIT. See [LICENSE](LICENSE).
