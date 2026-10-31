> Historical capture of the original UI. The mapping UI has since changed; this script and its artifacts do not verify the current selectors or production catalog flow.

# Browser proof against a fake API

This proof exercises the example server and the installed `@printhive/api` SDK against a loopback HTTP stub. The stub implements job creation, polling, release, and cancellation. It accepts only a dummy key. No production API or printer is involved.

Install Playwright outside this application's dependency tree and install its Chromium browser. Set `PLAYWRIGHT_MODULE` to the absolute path of Playwright's `index.mjs`, then run from the repository root:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/ui/run.mjs
```

The runner discovers form controls, rehearses the flows, then records them. It removes its temporary order store and closes both owned HTTP servers and the browser. It does not kill other processes.

The desktop browser checks these paths:

- Uploaded 3MF with two filament rows, automatic release, `preparing`, then `created` with a job ID.
- Bundled fixture with manual release, `preparing`, `held` with `manual_release_required`, Release, then `created`.
- Cancel during preparation, then `cancelled`, with Release and Cancel hidden.

The manual case uses plate 2 and changes the form to plate 1 after submission. Release still targets the submitted plate. A separate 390-pixel viewport checks the mobile layout and horizontal overflow. Browser requests are restricted to the example server's origin.

`results.json` records assertions and stub events. `node20-tests.log` and `node24-tests.log` record 13 passing tests, including the original nine. PNG files show the observed states, and `demo.webm` records the desktop paths. These artifacts prove browser behavior with scripted API responses, not slicing, production reliability, printer readiness, or physical printing. The API timing limitation in the root README still applies.

Artifact review checked the desktop state screenshots and mobile layout. The 22-second video decodes without errors, and sampled frames were inspected. Full video playback review remains pending; use the PNG screenshots as the reviewed visual evidence.
