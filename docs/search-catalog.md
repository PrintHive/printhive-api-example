# Search and select catalog resources

1. Run `npm ci` to install published SDK 0.4.0 from the lockfile.
2. Configure an owned local API and mock printers before any automated submission.
3. Search filaments with `black PETG` or `bambu red`.
4. Choose a result whose create-eligibility flag permits selection. If none is eligible, [sync an organization catalog filament](sync-catalog.md).
5. To share the choice, use **Apply to selected plates** and review the listed target plates. Open one plate and use **Change requirement** for an individual override.
6. Confirm source usage for each selected plate. Assignments can be made before confirmation; reconfirmation keeps choices for surviving slots.
7. Search printers with `Boo P1S` and select a result, or leave the printer ID empty for Smart Queue.
8. Preview the requests before submission.

Use organization-owned, synced catalog filaments with SDK 0.4.0. Global rows remain search-only until global acceptance is released. Do not replace a rejected catalog ID with a guessed material/color requirement. See the [SDK reference](sdk-upgrade.md) for the exact contract.
