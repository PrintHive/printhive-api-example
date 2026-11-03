# Try the pending search SDK locally

Keep the committed dependency and lockfile at 0.3.2. To test the pending methods without changing the main Hive checkout:

1. Fetch the PR and create a detached scratch worktree:

   ```sh
   git -C /path/to/hive fetch origin pull/5039/head
   git -C /path/to/hive worktree add --detach /tmp/hive-search-sdk FETCH_HEAD
   ```

2. Build `packages/api-client` in that worktree with the Hive repo's documented dependencies and build commands. Pack the built package into a `.tgz` with `npm pack`.
3. Install the packed archive in this sample:

   ```sh
   npm run sdk:local -- /path/to/printhive-api.tgz
   ```

4. Start the sample against an owned local API. Check that the banner identifies a local package build.
5. Search filaments with `black PETG` or `bambu red`, then search printers with `Boo P1S`.
6. Run `npm run verify`. Use mock printers only for any submission.
7. Restore the registry install with `npm ci`.
8. Remove the scratch worktree with `git -C /path/to/hive worktree remove /tmp/hive-search-sdk`.

Use a packed archive rather than a workspace link if you need to remove the worktree before restarting the sample. See the [SDK reference](sdk-upgrade.md) for the pending release and create-input limitation.
