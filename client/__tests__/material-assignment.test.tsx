import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";

const red = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Red PETG",
  brand: "Fixture",
  sku: "RED",
  materialType: "PETG",
  color: "#B44235",
  selectable: true,
  unavailableReason: null,
};
const blue = {
  ...red,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Blue PETG",
  color: "#296AAB",
};
const source = { sourceSlot: 0, material: "PETG", color: "#B44235" };
const project = {
  filename: "shared.3mf",
  sha256: "b".repeat(64),
  plates: [2, 7, 9].map((number) => ({
    number,
    filaments: [{ ...source, sourceSlot: number === 9 ? 1 : 0 }],
  })),
};
const extraction = {
  filename: "shared.3mf",
  sha256: "b".repeat(64),
  plates: [2, 7].map((number) => ({
    number,
    usage: { kind: "detected", sourceSlots: [0] },
  })),
  palette: [{ ...source, selectable: true }],
  warnings: [],
};
afterEach(() => vi.unstubAllGlobals());
function fixture(manual = false, options: { project?: typeof project } = {}) {
  let preview: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      const url = String(path);
      if (url === "/session") return Response.json({ token: "test-session" });
      if (url === "/config")
        return Response.json({
          baseUrl: "http://127.0.0.1:9999",
          production: false,
          maxUploadBytes: 16777216,
          sdk: {
            version: "0.4.1",
            source: "installed-package",
            capabilities: { filamentCatalog: true, printJobRead: true },
          },
        });
      if (url === "/project-data")
        return Response.json(
          manual
            ? (options.project ?? project)
            : { ...project, plates: [project.plates[0]] },
        );
      if (url === "/project-data/inspect") {
        const file =
          init?.body instanceof FormData ? init.body.get("file") : null;
        return Response.json({
          ...extraction,
          filename: file && typeof file !== "string" ? file.name : "shared.3mf",
        });
      }
      if (url.startsWith("/catalog?"))
        return Response.json({
          materials: [red, blue],
          total: 2,
          offset: 0,
          hasMore: false,
        });
      if (url === "/orders/preview") {
        preview = JSON.parse(String(init?.body));
        return Response.json({
          plates: [
            {
              plate: 2,
              filaments: [
                { sourceSlot: 0, material: "PETG", color: red.color },
              ],
            },
          ],
        });
      }
      throw new Error(`Unexpected fixture request ${url}`);
    }),
  );
  return { preview: () => preview };
}

it("reconfirming unchanged source usage preserves the plate material assignment", async () => {
  fixture();
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Project 3MF"),
    new File(["synthetic"], "shared.3mf"),
  );
  await user.click(
    await screen.findByRole("button", { name: "Use these source filaments" }),
  );
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  expect(screen.getByRole("button", { name: "Submit order" })).toBeEnabled();
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  expect(screen.getByText("Requirement: Fixture Red PETG")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeEnabled();
});

it("allows material assignment before usage confirmation without bypassing confirmation", async () => {
  fixture();
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Project 3MF"),
    new File(["synthetic"], "shared.3mf"),
  );
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  expect(screen.getByText("Requirement: Fixture Red PETG")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeEnabled();
});

it("shares a source assignment across plates and keeps a later individual override", async () => {
  const f = fixture(true);
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Configure plate 2" });
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  await user.click(screen.getByRole("checkbox", { name: "Include plate 9" }));
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  await user.click(
    screen.getByRole("button", {
      name: "Apply to selected plates using source slot 0",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Configure plate 7" }));
  expect(screen.getByText("Requirement: Fixture Red PETG")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Change requirement" }));
  await user.click(
    await screen.findByRole("button", { name: "Use Blue PETG" }),
  );
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  expect(screen.getByText("Requirement: Fixture Red PETG")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Configure plate 9" }));
  expect(screen.queryByText(/Requirement:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  await user.click(screen.getByRole("button", { name: "Preview API request" }));
  await waitFor(() =>
    expect(f.preview()).toMatchObject({
      plates: [2, 7, 9],
      plateMappings: [
        { plate: 2, mappings: [{ sourceSlot: 0, materialId: red.id }] },
        { plate: 7, mappings: [{ sourceSlot: 0, materialId: blue.id }] },
        { plate: 9, mappings: [{ sourceSlot: 1, materialId: red.id }] },
      ],
    }),
  );
});

it("keeps bulk assignments through late confirmation and clears them for another project", async () => {
  fixture();
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Project 3MF"),
    new File(["synthetic"], "shared.3mf"),
  );
  await user.click(
    await screen.findByRole("checkbox", { name: "Include plate 7" }),
  );
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  await user.click(
    screen.getByRole("button", {
      name: "Apply to selected plates using source slot 0",
    }),
  );
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  await user.click(screen.getByRole("button", { name: "Configure plate 7" }));
  expect(screen.getByText("Requirement: Fixture Red PETG")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Use these source filaments" }),
  );
  expect(screen.getByRole("button", { name: "Submit order" })).toBeEnabled();
  await user.upload(
    screen.getByLabelText("Project 3MF"),
    new File(["another project"], "new.3mf"),
  );
  await screen.findByRole("button", { name: "Use Red PETG" });
  expect(screen.queryByText(/Requirement:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
});

it("does not share a reused source slot when original material attributes differ", async () => {
  fixture(true, {
    project: {
      ...project,
      plates: project.plates.slice(0, 2).map((plate) => ({
        ...plate,
        filaments: plate.filaments.map((f) => ({
          ...f,
          material: plate.number === 7 ? "PLA" : "PETG",
        })),
      })),
    },
  });
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Configure plate 2" });
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  expect(
    screen.queryByRole("button", {
      name: "Apply to selected plates using source slot 0",
    }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Configure plate 7" }));
  expect(screen.queryByText(/Requirement:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit order" })).toBeDisabled();
});

it("copies material choices without copying named-printer placement hints", async () => {
  const f = fixture(true);
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Per-plate overrides" }));
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Configure plate 2" });
  await user.click(screen.getByRole("checkbox", { name: "Include plate 7" }));
  await user.click(screen.getByRole("button", { name: "Configure plate 2" }));
  await user.click(await screen.findByRole("button", { name: "Use Red PETG" }));
  await user.type(
    screen.getByLabelText("Printer ID (optional)"),
    "22222222-2222-4222-8222-222222222222",
  );
  await user.click(screen.getByText("Optional placement on a named printer"));
  await user.type(screen.getByLabelText("API AMS ID for source slot 0"), "0");
  await user.type(screen.getByLabelText("API slot ID for source slot 0"), "1");
  await user.click(
    screen.getByRole("button", {
      name: "Apply to selected plates using source slot 0",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Preview API request" }));
  await waitFor(() =>
    expect(f.preview()).toEqual(
      expect.objectContaining({
        plateMappings: [
          {
            plate: 2,
            mappings: [
              {
                sourceSlot: 0,
                materialId: red.id,
                targetSlot: { ams_id: 0, slot_id: 1 },
              },
            ],
          },
          { plate: 7, mappings: [{ sourceSlot: 0, materialId: red.id }] },
        ],
      }),
    ),
  );
});
