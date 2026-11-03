import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";

const material = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Fixture PETG",
  brand: "Fixture",
  sku: "PETG-TEST",
  materialType: "PETG",
  color: "#39FF14",
  selectable: true,
  unavailableReason: null,
};
const project = {
  filename: "cube.3mf",
  sha256: "a".repeat(64),
  plates: [
    {
      number: 1,
      filaments: [
        { sourceSlot: 0, name: "Cube", material: "PETG", color: "#39FF14" },
      ],
    },
  ],
};
const config = {
  baseUrl: "http://127.0.0.1:9999",
  production: false,
  maxUploadBytes: 16 * 1024 * 1024,
  sdk: {
    version: "0.3.1",
    source: "local-workspace",
    capabilities: { filamentCatalog: true, printJobRead: true },
  },
};

afterEach(() => vi.unstubAllGlobals());
function fixture(
  extra?: (path: string, init?: RequestInit) => Response | undefined,
) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const response = extra?.(path, init);
    if (response) return response;
    if (path === "/config") return Response.json(config);
    if (path === "/project-data") return Response.json(project);
    if (path.startsWith("/catalog?"))
      return Response.json({
        materials: [material],
        total: 1,
        offset: 0,
        hasMore: false,
      });
    throw new Error(`Unexpected fixture request ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("React order workflow", () => {
  it("loads the destination and blocks submission until a requirement is selected", async () => {
    const calls = fixture();
    render(<App />);
    expect(await screen.findByText("Use Fixture PETG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use Fixture PETG" }));
    expect(screen.getByRole("button", { name: "Submit order" })).toBeEnabled();
    expect(screen.getByLabelText("Release mode")).toHaveValue("manual");
    expect(calls.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });

  it("previews actual mappings and keeps material matching and placement explicit", async () => {
    let preview: unknown;
    fixture((path, init) => {
      if (path !== "/orders/preview") return;
      preview = JSON.parse(String(init?.body));
      return Response.json({
        plate: 1,
        filaments: [
          {
            sourceSlot: 0,
            material: "PETG",
            color: "#39FF14",
            targetSlot: { ams_id: 0, slot_id: 3 },
          },
        ],
      });
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Use Fixture PETG" }),
    );
    await user.type(
      screen.getByLabelText("Printer ID (optional)"),
      "22222222-2222-4222-8222-222222222222",
    );
    await user.click(screen.getByText("Optional placement on a named printer"));
    await user.type(screen.getByLabelText("API AMS ID for source slot 0"), "0");
    await user.type(
      screen.getByLabelText("API slot ID for source slot 0"),
      "3",
    );
    await user.click(
      screen.getByRole("button", { name: "Preview API request" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("API request preview")).toHaveTextContent(
        "targetSlot",
      ),
    );
    expect(preview).toMatchObject({
      plates: [1],
      release: "manual",
      on_filament_mismatch: "wait",
      mappings: [
        {
          sourceSlot: 0,
          materialId: material.id,
          targetSlot: { ams_id: 0, slot_id: 3 },
        },
      ],
    });
  });

  it("retries an uncertain submission with the same immutable order identity", async () => {
    const submitted: string[] = [];
    let id = "";
    fixture((path, init) => {
      if (path === "/orders") {
        const input = JSON.parse(String(init?.body));
        submitted.push(input.id);
        id = input.id;
        if (submitted.length === 1)
          return Response.json(
            { error: "Connection outcome unknown" },
            { status: 503 },
          );
        return Response.json(
          { id, requests: [{ plate: 1, requestId: "request-1" }] },
          { status: 202 },
        );
      }
      if (path.startsWith("/orders/"))
        return Response.json({
          id,
          plates: [
            {
              requestId: "request-1",
              status: "held",
              job: null,
              requiredActions: [{ code: "manual_release_required" }],
              error: null,
            },
          ],
        });
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Use Fixture PETG" }),
    );
    await user.click(screen.getByRole("button", { name: "Submit order" }));
    expect(
      await screen.findByRole("button", { name: "Retry same order" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Printer ID (optional)")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry same order" }));
    expect(
      await screen.findByRole("button", { name: /^Release$/ }),
    ).toBeInTheDocument();
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toBe(submitted[1]);
  });
});

it("searches printers by free text and uses the selected UUID", async () => {
  const calls = fixture((path) => {
    if (!path.startsWith("/printers?")) return;
    return Response.json({
      printers: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Boo",
          model: "P1S",
          status: "idle",
        },
      ],
      total: 1,
      offset: 0,
      hasMore: false,
    });
  });
  render(<App />);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Find a printer by name or model"),
    "Boo P1S",
  );
  await user.click(screen.getByRole("button", { name: "Find printers" }));
  await user.click(await screen.findByRole("button", { name: "Use Boo" }));
  expect(screen.getByLabelText("Printer ID (optional)")).toHaveValue(
    "22222222-2222-4222-8222-222222222222",
  );
  expect(
    calls.mock.calls.some(
      ([path]) => String(path) === "/printers?q=Boo+P1S&offset=0",
    ),
  ).toBe(true);
});
