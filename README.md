# Slice a 3MF and create a Print Hive job

We'll run a React app with a Node backend, select plates from a project 3MF, and submit it for cloud slicing. The backend uses `@printhive/api@0.4.0`. Each plate creates one request and, after preparation and release, one job.

Use an owned local Hive API with mock printers for this tutorial. A production destination can queue a real print. The sample defaults to manual release so you can review the prepared request first.

## 1. Run the sample

Clone the sample and install its dependencies with Node.js 20.19 or later:

```sh
git clone https://github.com/PrintHive/printhive-api-example.git
cd printhive-api-example
npm ci
npm ls @printhive/api
```

Expect `@printhive/api@0.4.0`. Set the destination and an organization API key privately in your server environment:

```sh
export PRINTHIVE_BASE_URL=http://127.0.0.1:YOUR_LOCAL_API_PORT
export PRINTHIVE_API_KEY=YOUR_LOCAL_MOCK_ORGANIZATION_KEY
npm run dev
```

Replace both placeholders with values from your owned local Hive stack. The key needs Control permission to create, release, or cancel work. Read permission covers search and status. Never put the key in client code or commit it. This repo does not provision Hive, its slicing engine, or mock printers.

Open <http://127.0.0.1:5173>. Check the API destination banner. The Node backend listens on 3078; `API_PORT` changes that port. The browser calls the Node backend, which owns the SDK and credentials.

## 2. Choose a project and plate

Leave **Project 3MF** empty to use `fixtures/cube.3mf`. This synthetic project contains a small PETG cube for a P1S with a 0.4 mm nozzle. Choose **Plate 1** and keep **Manual · review first** selected.

For your own project, choose a `.3mf` file. Select **Include plate** on each plate you want to submit. Click a preview to configure that plate, then confirm its source filaments. Each selected plate keeps its own mapping. The cards show saved PNG previews from the project. A plate with no usable image shows **No saved preview** and remains selectable. Saved previews and usage metadata can be stale.

This step makes no SDK call. The file upload to Hive happens in `client.printJobs.create` after you submit. Metadata extraction neither slices the file nor clears Hive inspection holds.

## 3. Map filaments and choose a printer

Search for a filament, then select a result with **Use**. Assignments are available as soon as a source is selected, before usage confirmation. The source slot identifies a filament in the project; it does not identify a printer tray.

The search adapter uses the following SDK call when the installed SDK provides it:

```ts
const page = await client.filaments.search({ query: "black PETG", limit: 20, offset: 0 });
const filament = page.filaments.find((row) => row.acceptedByCreate);
if (!filament) throw new Error("Sync an organization catalog filament first");
const filamentId = filament.filamentId;
```

The UI sends free-text queries through the published SDK. Try `black PETG` or `bambu red`. Results marked unavailable stay visible but cannot be selected. In 0.4.0, creation accepts catalog IDs only for organization-owned, synced catalog rows. Use the [catalog sync guide](docs/sync-catalog.md) if your search has no eligible results. Global catalog IDs are not accepted yet; support is pending in 0.4.1 under Hive PR #5094.

Under **Choose the destination**, search for a printer such as `Boo P1S`. With the search SDK installed, the backend calls:

```ts
const page = await client.printers.search({ query: "Boo P1S", limit: 20, offset: 0 });
```

Select an owned mock printer, or leave **Printer ID** empty for Smart Queue assignment. A search result does not establish loaded filament or readiness.

To reuse a choice on selected plates with the same original source, click **Apply to selected plates using source slot N**. For a different choice on one plate, open that plate and click **Change requirement**. Confirm source usage for every selected plate before submission. Click **Preview API request**. Expect a `plates` list with one-based plate numbers and zero-based `sourceSlot` entries. The backend retains the selected `filamentId` in each mapping and sends it to create. It also snapshots the matching material and color. These values must agree with the organization catalog row. Matching still uses material and color proximity rather than exact SKU identity.

## 4. Upload and slice the plate

Click **Submit order**. The backend saves the source bytes and one idempotency key per plate before calling the SDK. In `src/orders.mjs`, `record.source` names that private copy under `ORDER_DATA_DIR`, which defaults to `data/`. The call has this shape:

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

The browser polls this backend's `GET /orders/{id}` once per second. The backend calls `client.printJobs.getCreateRequest(requestId)` for each plate. When preparation permits manual review, expect `held` and the required action `manual_release_required`.

## 5. Review the hold

Read **Required actions**. In your local mock environment, click **Release** to authorize the manual hold, or **Cancel** to stop before job creation.

SDK 0.4.0 has no release or cancel method. `src/client.mjs` provides a server-only HTTP helper for `POST /v1/print-jobs/create-requests/{requestId}/release` and `/cancel`. The UI labels these operations as HTTP. Release cannot approve unrelated preparation holds.

## 6. Follow the job

Choose a plate in **Selected plate requests** to review its status and control that plate. After release, expect `created` and a job ID. The backend then reads the live job:

```ts
const receipt = await client.printJobs.getCreateRequest(request.requestId);
if (receipt.status === "created" && receipt.job) {
	const job = await client.printJobs.get(receipt.job.id);
}
```

The UI keeps the creation receipt separate from live job status. A job can wait for material or printer readiness. The waiting panel shows only API-reported requirements and physical placement hints. It never converts a source slot into a tray index.

Stop here in the mock environment. A created job does not prove a physical print completed.

For other tasks, use the [CLI and HTTP guide](docs/send-orders.md), [catalog mapping guide](docs/map-filaments.md), [catalog sync guide](docs/sync-catalog.md), or [SDK reference](docs/sdk-upgrade.md). To check your changes, run `npm run verify`.

MIT. See [LICENSE](LICENSE).
