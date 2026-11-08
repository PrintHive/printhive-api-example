# Send and recover orders

## Use the CLI

1. Set `PRINTHIVE_API_KEY_FILE` or `PRINTHIVE_API_KEY`, and `PRINTHIVE_BASE_URL` on the server.
2. Review `fixtures/order.json`. Use mock printers and a local API for tests.
3. Run `npm run send-print -- fixtures/order.json`.
4. Read the returned request IDs. For a held request, inspect its required actions before release.

```sh
npm run send-print -- status ORDER_ID
npm run send-print -- release REQUEST_ID
npm run send-print -- cancel ANOTHER_REQUEST_ID
```

To select several plates, set `plates` to their one-based numbers. Supply zero-based source slots with a catalog `filamentId`, or with material and hex color requirements. These CLI filament requirements apply to every listed plate. Use the browser for independent mappings per plate. To pin a printer, set `printer_id`.

After a transport failure or restart, rerun the same command with unchanged input. Keep `data/` across restarts. A changed file, mapping, release policy, or target needs a new order ID. Read status after a lost release or cancel response before repeating that action.

If creation returns 503 `catalog_store_failed`, retry the unchanged order after the catalog service recovers. Keep the order ID and source bytes. See the [catalog creation error reference](sdk-upgrade.md#catalog-creation-errors) for other failures.

## Run the built HTTP app

```sh
npm run build
PORT=3081 npm start
```

Open <http://127.0.0.1:3081>. To submit a server-side fixture directly:

```sh
SESSION=$(curl --fail --silent http://127.0.0.1:3081/session | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).token')
curl --fail-with-body http://127.0.0.1:3081/orders \
  -H "X-PrintHive-Session: $SESSION" \
  -H 'Content-Type: application/json' \
  -d '{"id":"sample-1001","file":"cube.3mf","plates":[1],"filaments":[{"sourceSlot":0,"material":"PETG","color":"#39FF14"}],"release":"manual"}'
curl --fail-with-body http://127.0.0.1:3081/orders/sample-1001 -H "X-PrintHive-Session: $SESSION"
```

For browser uploads, send multipart `POST /orders` with an `order` JSON field and a `file` field. The file limit is 150 MiB, plus at most 64 KiB for multipart metadata. Uploads stream to temporary disk, one at a time, and allow ten minutes. JSON requests have a 64 KiB limit. Use `POST /orders/{id}/{plate}/release` or `/cancel` to control a request before job creation. These actions read the request ID from the local order record. Once a job exists, cancel it in the Hive app.

Automatic HTTP orders require `automaticConfirmed: true` and `confirmedDestination` equal to the exact `printer_id`, or `"smart-queue"` when no printer is specified. Manual orders need no automatic confirmation.

The browser remembers the active order in session storage and polls while plates upload. After a reload or backend restart, it resumes status and renews the local session automatically. Use `POST /orders/{id}/retry` to retry pending submissions from the saved source and keys without another upload. Final 4xx rejections, except 429, are not retried. The browser offers **New order** once all creation requests settle.

## Prepare a hosted integration

Keep the API key on the backend. Add authentication, order authorization, and request limits before exposing the sample server. Provision trusted designs under `DESIGN_DIR`; do not accept customer filesystem paths.

Run one backend process per `ORDER_DATA_DIR`. For several processes, replace the local store with a transactional database that enforces unique order and plate keys. Add source retention, backups, and serialized writes.
