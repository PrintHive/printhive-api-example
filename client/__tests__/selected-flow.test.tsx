import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import { useOrderWorkflow } from "../lib/use-order-workflow";
import { progressOf } from "../lib/plate-progress";
import { receiptSchema } from "../lib/api";

const red = { id: "11111111-1111-4111-8111-111111111111", name: "Red PETG", brand: "Bambu", sku: null, materialType: "PETG", color: "#ff0000", selectable: true, unavailableReason: null };
const black = { ...red, id: "33333333-3333-4333-8333-333333333333", name: "Black PETG", color: "#000000" };
const sources = [0, 1, 2].map(sourceSlot => ({ sourceSlot, material: "PETG", color: sourceSlot ? "#000000" : "#ff0000", selectable: true }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture(extra?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  let submitted: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const override = await extra?.(path, init);
    if (override) return override;
    if (path === "/session") return Response.json({ token: "test-session" });
    if (path === "/config") return Response.json({ baseUrl: "http://127.0.0.1:9999", production: false, maxUploadBytes: 157286400, sdk: { version: "0.6.0", source: "installed-package", capabilities: { filamentCatalog: true, printJobRead: true } } });
    if (path === "/project-data") return Response.json({ filename: "cube.3mf", sha256: "a".repeat(64), plates: [{ number: 1, filaments: [sources[0]] }] });
    if (path === "/project-data/inspect") return Response.json({ filename: "shared.3mf", sha256: "b".repeat(64), plates: [2, 7, 9].map((number, index) => ({ number, preview: null, usage: { kind: "detected", sourceSlots: index === 0 ? [0] : index === 1 ? [0, 1] : [2] } })), palette: sources, warnings: [] });
    if (path.startsWith("/catalog?")) return Response.json({ materials: [red, black], total: 2, offset: 0, hasMore: false });
    if (path.startsWith("/printers?")) return Response.json({ printers: [{ id: "22222222-2222-4222-8222-222222222222", name: "Boo P1S", model: "P1S", status: "idle" }], total: 1, offset: 0, hasMore: false });
    if (path === "/orders") {
      submitted = JSON.parse(init?.body instanceof FormData ? String(init.body.get("order")) : String(init?.body));
      return Response.json({ id: submitted?.id, requests: [{ plate: 1, requestId: "request-1" }] });
    }
    if (path.startsWith("/orders/")) return Response.json({ id: submitted?.id, plates: [{ plate: 1, requestId: "request-1", status: "failed", error: { error: "slicing_failed", message: "Fixture failure" } }] });
    throw new Error(path);
  }));
  return () => submitted;
}
it("maps the union once, excludes unselected slots, and sends each plate's own slots", async () => {
  const submitted = fixture(), user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "Use Red PETG" });
  await user.upload(screen.getByLabelText("Project 3MF"), new File(["fixture"], "shared.3mf"));
  await screen.findByRole("checkbox", { name: "Include plate 7" });
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  expect(document.querySelectorAll('[data-selected-source]')).toHaveLength(2);
  expect(document.querySelector('[data-selected-source="2"]')).toBeNull();
  await user.click(screen.getByRole("button", { name: "Confirm saved usage for selected plates" }));
  const slot0 = document.querySelector('[data-selected-source="0"]');
  const slot1 = document.querySelector('[data-selected-source="1"]');
  if (!(slot0 instanceof HTMLElement) || !(slot1 instanceof HTMLElement)) throw new Error("Missing slots");
  await user.click(await within(slot0).findByRole("button", { name: "Use Red PETG" }));
  await user.click(await within(slot1).findByRole("button", { name: "Use Black PETG" }));
  await user.click(screen.getByRole("button", { name: "Submit order" }));
  await waitFor(() => expect(submitted()).toMatchObject({ plates: [2, 7], release: "manual", plateMappings: [
    { plate: 2, mappings: [{ sourceSlot: 0, materialId: red.id }] },
    { plate: 7, mappings: [{ sourceSlot: 0, materialId: red.id }, { sourceSlot: 1, materialId: black.id }] },
  ] }));
});
it.each(["Smart Queue", "Boo P1S"])("requires automatic confirmation naming %s and can decline without sending", async destination => {
  const submitted = fixture(), user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  expect(screen.getByLabelText("Release mode")).toHaveValue("manual");
  if (destination === "Boo P1S") {
    await user.type(screen.getByLabelText("Find a printer by name or model"), "Boo P1S");
    await user.click(screen.getByRole("button", { name: "Find printers" }));
    await user.click(await screen.findByRole("button", { name: "Use Boo P1S" }));
  }
  await user.selectOptions(screen.getByLabelText("Release mode"), "automatic");
  await user.click(screen.getByRole("button", { name: "Submit order" }));
  expect(screen.getByRole("alertdialog", { name: "Confirm automatic printing" })).toHaveTextContent(destination === "Boo P1S" ? "Destination: Boo P1S · P1S · …22222222." : "Destination: Smart Queue.");
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Start real prints on the farm?");
  expect(submitted()).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Go back" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit order" }));
  await user.click(screen.getByRole("button", { name: "Confirm automatic printing" }));
  await waitFor(() => expect(submitted()).toMatchObject({ release: "automatic", automaticConfirmed: true, confirmedDestination: destination === "Boo P1S" ? "22222222-2222-4222-8222-222222222222" : "smart-queue", ...(destination === "Boo P1S" ? { printer_id: "22222222-2222-4222-8222-222222222222" } : {}) }));
});
it("shows API codes and reasons and keeps queued jobs separate from slicing", () => {
  expect(progressOf(receiptSchema.parse({ status: "failed", error: { code: "filaments_do_not_cover_plate", message: "Missing source slot 3", missingSlots: [3] } }))).toEqual({ label: "Failed", reason: "filaments_do_not_cover_plate: Missing source slot 3: Missing source slots: 3" });
  expect(progressOf(receiptSchema.parse({ status: "created", job: { id: 42 }, jobRead: { kind: "available", job: { id: 42, status: "QUEUED" } } })).label).toBe("Queued · job created");
});

it.each(['release', 'printer', 'plates', 'mappings', 'mapping view', 'Smart Queue'])("clears pending automatic confirmation when changing %s", async change => {
  const submitted = fixture(), user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Use Red PETG' }));
  await user.type(screen.getByLabelText('Find a printer by name or model'), 'Boo');
  await user.click(screen.getByRole('button', { name: 'Find printers' }));
  await user.click(await screen.findByRole('button', { name: 'Use Boo P1S' }));
  await user.selectOptions(screen.getByLabelText('Release mode'), 'automatic');
  await user.click(screen.getByRole('button', { name: 'Submit order' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Boo P1S');
  if (change === 'release') await user.selectOptions(screen.getByLabelText('Release mode'), 'manual');
  if (change === 'printer') await user.clear(screen.getByLabelText('Printer ID (optional)'));
  if (change === 'plates') await user.click(screen.getByRole('checkbox', { name: 'Include plate 1' }));
  if (change === 'mappings') {
    await user.click(screen.getByRole('button', { name: 'Change requirement' }));
    await user.click(await screen.findByRole('button', { name: 'Use Black PETG' }));
  }
  if (change === 'mapping view') await user.click(screen.getByRole('button', { name: 'Per-plate overrides' }));
  if (change === 'Smart Queue') await user.click(screen.getByRole('button', { name: 'Use Smart Queue' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(submitted()).toBeUndefined();
  if (change === 'release') {
    await user.click(screen.getByRole('button', { name: 'Submit order' }));
    await waitFor(() => expect(submitted()?.release).toBe('manual'));
    expect(submitted()?.automaticConfirmed).toBeUndefined();
  }
});

it('Enter never submits and printer IDs are trimmed and validated before sending', async () => {
  const submitted = fixture(), user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Use Red PETG' }));
  const printer = screen.getByLabelText('Printer ID (optional)');
  await user.type(printer, 'invalid{Enter}');
  fireEvent.submit(document.querySelector('#order-form')!);
  expect(submitted()).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'Submit order' }));
  expect(await screen.findByText(/Printer ID must be a UUID/)).toBeInTheDocument();
  expect(submitted()).toBeUndefined();
  await user.clear(printer);
  await user.type(printer, '   ');
  expect(screen.getByText('Destination: Smart Queue')).toBeInTheDocument();
  await user.type(printer, '22222222-2222-4222-8222-222222222222   ');
  await user.click(screen.getByRole('button', { name: 'Submit order' }));
  await waitFor(() => expect(submitted()?.printer_id).toBe('22222222-2222-4222-8222-222222222222'));
});

it('polls during upload, guards unload, resumes on reload without POST, and offers New order after settlement', async () => {
  let finish!: (response: Response) => void;
  let orderId = '', posts = 0, phase = 'pending_submission';
  fixture((path, init) => {
    if (path === '/orders') {
      posts++; orderId = JSON.parse(String(init?.body)).id;
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    if (path.startsWith('/orders/')) return Response.json({ id: path.split('/')[2], plates: [{ plate: 1, status: phase, requestId: phase === 'held' ? 'held-1' : null, requiredActions: [{ code: 'preparation_lineage_unreadable' }] }] });
  });
  const user = userEvent.setup(), first = render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Use Red PETG' }));
  await user.click(screen.getByRole('button', { name: 'Submit order' }));
  expect(await screen.findByRole('button', { name: 'Plate 1 · pending_submission' })).toBeInTheDocument();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  expect(JSON.parse(sessionStorage.getItem('printhive-active-order')!).id).toBe(orderId);
  first.unmount(); phase = 'held';
  render(<App />);
  await screen.findByRole('button', { name: 'Plate 1 · held' });
  expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
  expect(posts).toBe(1);
  phase = 'failed';
  await user.click(screen.getByRole('button', { name: 'Refresh status' }));
  await user.click(await screen.findByRole('button', { name: 'New order' }));
  expect(sessionStorage.getItem('printhive-active-order')).toBeNull();
  expect(screen.getByRole('button', { name: 'Submit order' })).toBeInTheDocument();
  await act(async () => finish(Response.json({ id: orderId, requests: [{ plate: 1, requestId: 'held-1' }] })));
});

it('backs off to five seconds for jobs and stops for terminal jobs', async () => {
  let polls = 0, status = 'QUEUED';
  fixture(path => {
    if (path.startsWith('/orders/')) { polls++; return Response.json({ id: 'persisted', plates: [{ plate: 1, requestId: 'job-1', status: 'created', job: { id: 42 }, jobRead: { kind: 'available', job: { id: 42, status } } }] }); }
  });
  sessionStorage.setItem('printhive-active-order', JSON.stringify({ id: 'persisted', plates: [1] }));
  vi.useFakeTimers();
  const hook = renderHook(() => useOrderWorkflow());
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(polls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); }); expect(polls).toBe(1);
    status = 'COMPLETED';
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(polls).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(polls).toBe(2);
  } finally { hook.unmount(); vi.useRealTimers(); }
});

it('approves only the exact reported engine settings and points other holds to Hive', async () => {
  const review = { changes: [{ key: 'speed', sourceValue: '50', engineValue: '60', slots: [1] }], sourceRelease: 'old', engineRelease: 'new' };
  let approved: unknown;
  fixture((path, init) => {
    if (path.endsWith('/approve-review')) { approved = JSON.parse(String(init?.body)); return Response.json({ approved: true }); }
    if (path.startsWith('/orders/')) return Response.json({ id: 'review', plates: [{ plate: 1, requestId: 'review-1', status: 'held', requiredActions: [{ item: 0, plateNumber: 1, hold: { code: 'project_review_required', detail: 'Engine upgrade', ...review } }] }] });
  });
  sessionStorage.setItem('printhive-active-order', JSON.stringify({ id: 'review', plates: [1] }));
  render(<App />);
  await screen.findByRole('button', { name: 'Plate 1 · held' });
  expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Engine settings to approve')).toHaveTextContent('speed');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Approve reported engine settings' }));
  await waitFor(() => expect(approved).toEqual(review));
});
