# Sync your store's filament catalog

1. Expand **Sync your store filament catalog** below the order form.
2. Import JSON records with stable external IDs:

```json
[{
	"externalId": "store-filament-123",
	"brand": "Example",
	"material": "PETG",
	"colorName": "Green",
	"colorHex": "#39FF14",
	"sku": "PETG-GREEN"
}]
```

3. Preview the records. Preview validates the batch without SDK writes.
4. Click the sync action to call `client.filamentCatalog.upsert(record)` for each record.
5. Read back a binding with the panel's list and ID controls. These use `client.filamentCatalog.list` and `client.filamentCatalog.get`.

Keep `externalId` stable when updating a catalog record. Use the returned Hive UUID for filament mapping. An external ID, a project source slot, and a Hive UUID identify different things.

Use Control permission for upsert and Read permission for list and get. If some records fail, review their sanitized errors and retry the failed records. A catalog sync creates no print job.
