import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import { progressOf } from "../lib/plate-progress";
import { receiptSchema } from "../lib/api";

const red = { id: "11111111-1111-4111-8111-111111111111", name: "Red PETG", brand: "Bambu", sku: null, materialType: "PETG", color: "#ff0000", selectable: true, unavailableReason: null };
const black = { ...red, id: "33333333-3333-4333-8333-333333333333", name: "Black PETG", color: "#000000" };
const sources = [0, 1, 2].map(sourceSlot => ({ sourceSlot, material: "PETG", color: sourceSlot ? "#000000" : "#ff0000", selectable: true }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  let submitted: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/session") return Response.json({ token: "test-session" });
    if (path === "/config") return Response.json({ baseUrl: "http://127.0.0.1:9999", production: false, maxUploadBytes: 16777216, sdk: { version: "0.6.0", source: "installed-package", capabilities: { filamentCatalog: true, printJobRead: true } } });
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
  expect(screen.getByRole("alertdialog", { name: "Confirm automatic printing" })).toHaveTextContent(`Destination: ${destination}.`);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Start real prints on the farm?");
  expect(submitted()).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Go back" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit order" }));
  await user.click(screen.getByRole("button", { name: "Confirm automatic printing" }));
  await waitFor(() => expect(submitted()?.release).toBe("automatic"));
});
it("shows API codes and reasons and keeps queued jobs separate from slicing", () => {
  expect(progressOf(receiptSchema.parse({ status: "failed", error: { body: { error: "filaments_do_not_cover_plate", message: "Missing source slot 3" } } }))).toEqual({ label: "Failed", reason: "filaments_do_not_cover_plate: Missing source slot 3" });
  expect(progressOf(receiptSchema.parse({ status: "created", job: { id: 42 }, jobRead: { kind: "available", job: { id: 42, status: "QUEUED" } } })).label).toBe("Queued · job created");
});
