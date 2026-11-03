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
    await user.click(screen.getByRole("checkbox", { name: "Include plate 1" }));
    expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Configure plate 1" }));
    expect(
      screen.getByRole("checkbox", { name: "Include plate 1" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
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
        plates: [
          {
            plate: 1,
            filaments: [
              {
                sourceSlot: 0,
                material: "PETG",
                color: "#39FF14",
                targetSlot: { ams_id: 0, slot_id: 3 },
              },
            ],
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
      plateMappings: [
        {
          plate: 1,
          mappings: [
            {
              sourceSlot: 0,
              materialId: material.id,
              targetSlot: { ams_id: 0, slot_id: 3 },
            },
          ],
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

it("labels an exact catalog ID read as HTTP without claiming SDK search is unavailable", async () => {
  fixture((path) => {
    if (path !== `/catalog?q=${material.id}&offset=0`) return;
    return Response.json({
      materials: [material],
      total: 1,
      offset: 0,
      hasMore: false,
      mode: "catalog-item-http",
    });
  });
  render(<App />);
  await screen.findByRole("button", { name: "Use Fixture PETG" });
  const user = userEvent.setup();
  const query = screen.getByLabelText(
    "Find a Hive filament by name, SKU, or ID",
  );
  await user.clear(query);
  await user.type(query, material.id);
  await user.click(screen.getByRole("button", { name: "Search" }));
  expect(
    await screen.findByText(/HTTP GET \/v1\/materials\/\{id\}/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/SDK search unavailable/)).not.toBeInTheDocument();
});

it("selects preview cards, preserves per-plate mappings, and controls each submitted plate separately", async () => {
  const blue = {
    ...material,
    id: "22222222-2222-4222-8222-222222222222",
    name: "Blue PETG",
    color: "#296AAB",
  };
  const savedPreview = "data:image/png;base64,iVBORw0KGgo=";
  const phases: Record<number, string> = { 2: "held", 7: "held" };
  const actions: string[] = [];
  let submitted: unknown;
  let id = "";
  fixture((path, init) => {
    if (path === "/project-data/inspect")
      return Response.json({
        filename: "plates.3mf",
        sha256: "b".repeat(64),
        plates: [
          {
            number: 2,
            name: "Red part",
            preview: savedPreview,
            usage: { kind: "detected", sourceSlots: [0] },
          },
          {
            number: 7,
            name: "Blue part",
            preview: null,
            usage: { kind: "detected", sourceSlots: [1] },
          },
        ],
        palette: [
          {
            sourceSlot: 0,
            material: "PETG",
            color: "#B44235",
            selectable: true,
          },
          {
            sourceSlot: 1,
            material: "PETG",
            color: "#296AAB",
            selectable: true,
          },
        ],
        warnings: [],
      });
    if (path.startsWith("/catalog?"))
      return Response.json({
        materials: [material, blue],
        total: 2,
        offset: 0,
        hasMore: false,
      });
    if (path === "/orders") {
      if (!(init?.body instanceof FormData))
        throw new Error("Expected one multipart source upload");
      const text = String(init.body.get("order"));
      expect(text).not.toContain("data:image");
      const input = JSON.parse(text);
      submitted = input;
      id = input.id;
      return Response.json(
        {
          id,
          requests: [
            { plate: 2, requestId: "request-2" },
            { plate: 7, requestId: "request-7" },
          ],
        },
        { status: 202 },
      );
    }
    if (path.startsWith("/orders/") && init?.method === "POST") {
      actions.push(path);
      const plate = Number(path.split("/")[3]);
      phases[plate] = path.endsWith("/release") ? "created" : "cancelled";
      return Response.json({ status: phases[plate] });
    }
    if (path === `/orders/${id}`)
      return Response.json({
        id,
        plates: [2, 7].map((plate) => ({
          plate,
          requestId: `request-${plate}`,
          status: phases[plate],
          job: null,
          requiredActions:
            phases[plate] === "held"
              ? [{ code: "manual_release_required" }]
              : [],
        })),
      });
  });
  render(<App />);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Project 3MF"),
    new File(["synthetic archive"], "plates.3mf"),
  );
  expect(
    await screen.findByRole("img", { name: "Saved preview of plate 2" }),
  ).toHaveAttribute("src", savedPreview);
  expect(
    screen.getByRole("button", { name: "Configure plate 7" }),
  ).toHaveTextContent("No saved preview");
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Use Fixture PETG" }),
  );
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Use Blue PETG" }),
  );
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  expect(
    screen.getByText(/Requirement: Fixture Fixture PETG/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  expect(screen.getByText("1 of 2 plates selected")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  expect(
    screen.getByText(/Requirement: Fixture Blue PETG/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit order" }));
  await screen.findByRole("button", { name: "Plate 2 · held" });
  expect(submitted).toMatchObject({
    plates: [2, 7],
    plateMappings: [
      { plate: 2, mappings: [{ sourceSlot: 0, materialId: material.id }] },
      { plate: 7, mappings: [{ sourceSlot: 1, materialId: blue.id }] },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Release" }));
  await screen.findByRole("button", { name: "Plate 2 · created" });
  expect(actions).toContain(`/orders/${id}/2/release`);
  phases[7] = "preparing";
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Plate 7 · preparing" }),
      ).toBeInTheDocument(),
    { timeout: 2500 },
  );
  await user.click(screen.getByRole("button", { name: "Plate 7 · preparing" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(actions).toContain(`/orders/${id}/7/cancel`));
});
