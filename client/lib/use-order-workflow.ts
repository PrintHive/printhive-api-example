import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { validateProjectData } from "../../src/project-data.mjs";
import { mappedPlateInputs } from "../../src/mapped-plates.mjs";
import { shouldPollJob } from "../../src/job-status.mjs";
import { pruneSlots, sharedSourcePlates, selectedSourceGroups } from "./material-assignments";
import {
  acceptedSchema,
  api,
  configSchema,
  extractionSchema,
  json,
  message,
  orderSchema,
  plateSchema,
  previewSchema,
  projectSchema,
  type Config,
  type Extraction,
  type Hint,
  type MappedInput,
  type Material,
  type Order,
  type Plate,
  type Project,
  type Source,
} from "./api";

type Active = { id: string; plates: number[]; options: RequestInit | null };
export function useOrderWorkflow() {
  const [config, setConfig] = useState<Config | null>(null);
  const [bundled, setBundled] = useState<Project | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [extracted, setExtracted] = useState<Extraction | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plateNumber, setPlateNumber] = useState(1);
  const [selectedPlates, setSelectedPlates] = useState<number[]>([]);
  const [statusPlate, setStatusPlate] = useState(1);
  const [confirmed, setConfirmed] = useState<Record<number, Plate>>({});
  const [drafts, setDrafts] = useState<Record<number, number[]>>({});
  const [showAll, setShowAll] = useState<Record<number, boolean>>({});
  const [selections, setSelections] = useState<
    Record<number, Record<number, Material>>
  >({});
  const [hints, setHints] = useState<Record<number, Record<number, Hint>>>({});
  const [bulkNotice, setBulkNotice] = useState("");
  const [printer, setPrinter] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [mappingMode, setMappingMode] = useState<"selected" | "plate">("selected");
  const [automaticConfirmation, setAutomaticConfirmation] = useState<string | null>(null);
  const [release, setRelease] = useState("manual");
  const [policy, setPolicy] = useState("wait");
  const [manifest, setManifest] = useState("");
  const [projectError, setProjectError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const activeRef = useRef<Active | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<unknown>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const sourceMode = useRef<"bundled" | "file" | "manual">("bundled");
  const sourceGeneration = useRef(0),
    previewGeneration = useRef(0),
    pollGeneration = useRef(0);
  const extractionController = useRef<AbortController | null>(null);
  const pollController = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const currentSelections = selections[plateNumber] ?? {};
  const plateData = (number: number) =>
    extracted
      ? confirmed[number]
      : project?.plates.find((p) => p.number === number);
  function plateStatus(number: number) {
    if (!selectedPlates.includes(number)) return "Not selected";
    const plate = plateData(number);
    if (!plate) return "Confirm source usage";
    const missing = plate.filaments.filter(
      (f) => !selections[number]?.[f.sourceSlot],
    ).length;
    return missing
      ? `Map ${missing} source filament${missing === 1 ? "" : "s"}`
      : "Ready to submit";
  }
  const complete =
    selectedPlates.length > 0 &&
    selectedPlates.every((number) => plateStatus(number) === "Ready to submit");
  const usageFor = (number: number) =>
    extracted?.plates.find((p) => p.number === number)?.usage;
  const draftFor = (number: number) => {
    const usage = usageFor(number);
    return (
      drafts[number] ??
      (usage?.kind === "detected" ? (usage.sourceSlots ?? []) : [])
    );
  };
  const currentUsage = usageFor(plateNumber);
  const draft = draftFor(plateNumber);
  // Sources that mapping controls and bulk targets are built from: confirmed
  // usage when present, otherwise the plate's selectable draft slots.
  const plateSources = (number: number): Source[] => {
    if (!extracted)
      return project?.plates.find((p) => p.number === number)?.filaments ?? [];
    const plate = confirmed[number];
    if (plate) return plate.filaments;
    const slots = draftFor(number);
    return extracted.palette.flatMap((f) =>
      slots.includes(f.sourceSlot) && f.selectable && f.color !== null
        ? [
            {
              sourceSlot: f.sourceSlot,
              name: f.name,
              material: f.material,
              color: f.color,
            },
          ]
        : [],
    );
  };
  const currentSources = plateSources(plateNumber);
  const sourceGroups = selectedSourceGroups(selectedPlates.map(number => ({ number, sources: plateSources(number) })));
  function chooseGroup(source: Source, material: Material) {
    const group = sourceGroups.find(group => group.source === source);
    if (!group) return;
    setSelections(previous => {
      const next = { ...previous };
      for (const number of group.plates) next[number] = { ...next[number], [source.sourceSlot]: material };
      return next;
    });
    invalidate();
  }
  function groupSelection(source: Source, plates: number[]) {
    const choices = plates.map(number => selections[number]?.[source.sourceSlot]);
    const first = choices[0];
    return first && choices.every(choice => choice?.id === first.id) ? first : undefined;
  }
  const bulkTargets = (slot: number): number[] => {
    const anchor = currentSources.find((s) => s.sourceSlot === slot);
    if (!anchor || !currentSelections[slot]) return [];
    return sharedSourcePlates(
      anchor,
      selectedPlates
        .filter((number) => number !== plateNumber)
        .map((number) => ({ number, sources: plateSources(number) })),
    );
  };
  const invalidate = useCallback(() => {
    previewGeneration.current++;
    previewController.current?.abort();
    setPayload(null);
    setAutomaticConfirmation(null);
    setPreviewBusy(false);
  }, []);
  const clearProject = useCallback(() => {
    sourceGeneration.current++;
    extractionController.current?.abort();
    setProject(null);
    setSelectedPlates([]);
    setExtracted(null);
    setConfirmed({});
    setDrafts({});
    setShowAll({});
    setSelections({});
    setHints({});
    setBulkNotice("");
    setProjectError("");
    invalidate();
  }, [invalidate]);
  const installProject = useCallback((value: Project) => {
    setProject(value);
    setExtracted(null);
    setPlateNumber(value.plates[0]?.number ?? 1);
    setSelectedPlates(value.plates[0] ? [value.plates[0].number] : []);
    setManifest(JSON.stringify({ plates: value.plates }, null, 2));
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    Promise.all([
      api("/config", configSchema, { signal: controller.signal }),
      api("/project-data", projectSchema, { signal: controller.signal }),
    ])
      .then(([destination, data]) => {
        if (controller.signal.aborted) return;
        setConfig(destination);
        setBundled(data);
        if (sourceMode.current === "bundled") installProject(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => {
      mounted.current = false;
      controller.abort();
      extractionController.current?.abort();
      pollController.current?.abort();
      previewController.current?.abort();
      previewGeneration.current++;
      clearTimeout(timer.current);
      pollGeneration.current++;
    };
  }, [installProject]);
  async function selectFile(value: File | null) {
    if (activeRef.current || locked.current) return;
    sourceMode.current = value ? "file" : "bundled";
    clearProject();
    setFile(value);
    setManifest("");
    if (!value) {
      setExtracting(false);
      if (bundled) installProject(bundled);
      return;
    }
    const generation = sourceGeneration.current;
    const controller = new AbortController();
    extractionController.current = controller;
    setExtracting(true);
    try {
      if (!/\.3mf$/i.test(value.name) || !value.size)
        throw new Error("Choose a nonempty .3mf project");
      if (value.size > 16 * 1024 * 1024 - 65536)
        throw new Error("Choose a 3MF smaller than 16 MiB including form data");
      const body = new FormData();
      body.set("file", value);
      const data = await api("/project-data/inspect", extractionSchema, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (generation !== sourceGeneration.current || controller.signal.aborted)
        return;
      setExtracted(data);
      setProject({ filename: data.filename, sha256: data.sha256, plates: [] });
      setPlateNumber(data.plates[0]?.number ?? 1);
      setSelectedPlates(data.plates[0] ? [data.plates[0].number] : []);
    } catch (e) {
      if (!controller.signal.aborted && generation === sourceGeneration.current)
        setProjectError(message(e));
    } finally {
      if (generation === sourceGeneration.current) setExtracting(false);
    }
  }
  function editManifest(text: string) {
    sourceMode.current = "manual";
    clearProject();
    setExtracting(false);
    setManifest(text);
  }
  async function applyManifest(text = manifest) {
    sourceMode.current = "manual";
    clearProject();
    const generation = sourceGeneration.current;
    try {
      const validated = validateProjectData(JSON.parse(text));
      if (!file && !bundled) throw new Error("Project data is not ready");
      const hash = file
        ? [
            ...new Uint8Array(
              await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
            ),
          ]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : bundled?.sha256;
      if (generation !== sourceGeneration.current) return;
      installProject(
        projectSchema.parse({
          ...validated,
          filename: file?.name ?? bundled?.filename,
          sha256: hash,
        }),
      );
    } catch (e) {
      if (generation === sourceGeneration.current) setProjectError(message(e));
    }
  }
  async function importManifest(value: File | null) {
    if (!value || activeRef.current || locked.current) return;
    const generation = sourceGeneration.current;
    try {
      if (value.size > 65536)
        throw new Error("Project data JSON must be smaller than 64 KiB");
      const text = await value.text();
      if (generation !== sourceGeneration.current || !mounted.current) return;
      editManifest(text);
      await applyManifest(text);
    } catch (e) {
      if (generation === sourceGeneration.current) setProjectError(message(e));
    }
  }
  function changeUsage(slot: number, checked: boolean) {
    setDrafts((d) => ({
      ...d,
      [plateNumber]: checked
        ? [...new Set([...draft, slot])]
        : draft.filter((s) => s !== slot),
    }));
    setConfirmed((p) => {
      const next = { ...p };
      delete next[plateNumber];
      return next;
    });
    if (!checked) {
      setSelections((p) => pruneSlots(p, plateNumber, (s) => s !== slot));
      setHints((p) => pruneSlots(p, plateNumber, (s) => s !== slot));
    }
    setBulkNotice("");
    invalidate();
  }
  function confirmUsage() {
    if (!extracted || !draft.length) return;
    const values = extracted.palette.filter((f) =>
      draft.includes(f.sourceSlot),
    );
    if (values.length !== draft.length || values.some((f) => !f.selectable))
      return;
    const plate = plateSchema.parse({ number: plateNumber, filaments: values });
    const kept = (slot: number) => draft.includes(slot);
    setConfirmed((p) => ({ ...p, [plateNumber]: plate }));
    setSelections((p) => pruneSlots(p, plateNumber, kept));
    setHints((p) => pruneSlots(p, plateNumber, kept));
    invalidate();
  }
  function confirmSelectedUsage() {
    if (!extracted) return;
    setConfirmed(previous => {
      const next = { ...previous };
      for (const number of selectedPlates) {
        const usage = usageFor(number);
        if (usage?.kind !== "detected" || !usage.sourceSlots?.length || drafts[number]) continue;
        const values = extracted.palette.filter(source => usage.sourceSlots?.includes(source.sourceSlot));
        if (values.length === usage.sourceSlots.length && values.every(source => source.selectable))
          next[number] = plateSchema.parse({ number, filaments: values });
      }
      return next;
    });
    invalidate();
  }
  function applyToMatching(slot: number) {
    const material = currentSelections[slot];
    const targets = bulkTargets(slot);
    if (!material || !targets.length) return;
    setSelections((p) => {
      const next = { ...p };
      for (const number of targets)
        next[number] = { ...next[number], [slot]: material };
      return next;
    });
    setBulkNotice(
      `Applied ${[material.brand, material.name].filter(Boolean).join(" ")} to source slot ${slot} on ${targets.length === 1 ? "plate" : "plates"} ${targets.join(", ")} from plate ${plateNumber}.`,
    );
    invalidate();
  }
  function currentInput(): MappedInput {
    if (!project || !complete)
      throw new Error("Confirm and map every selected plate");
    const plates = selectedPlates.map((number) => {
      const plate = plateData(number);
      if (!plate) throw new Error(`Confirm source usage for plate ${number}`);
      return plate;
    });
    const input: MappedInput = {
      id: `browser-${crypto.randomUUID()}`,
      plates: selectedPlates,
      projectData: {
        filename: project.filename,
        sha256: project.sha256,
        plates,
      },
      plateMappings: plates.map((plate) => ({
        plate: plate.number,
        mappings: plate.filaments.map((f) => {
          const selected = selections[plate.number]?.[f.sourceSlot];
          if (!selected)
            throw new Error(
              `Select every requirement on plate ${plate.number}`,
            );
          const hint = printer.trim()
            ? hints[plate.number]?.[f.sourceSlot]
            : undefined;
          if (hint && (hint.ams === "") !== (hint.slot === ""))
            throw new Error(
              `Plate ${plate.number}, source slot ${f.sourceSlot}: enter both placement indices or leave both empty`,
            );
          return {
            sourceSlot: f.sourceSlot,
            materialId: selected.id,
            ...(hint && hint.ams !== "" && hint.slot !== ""
              ? {
                  targetSlot: {
                    ams_id: Number(hint.ams),
                    slot_id: Number(hint.slot),
                  },
                }
              : {}),
          };
        }),
      })),
      release,
      on_filament_mismatch: policy,
      ...(printer.trim() ? { printer_id: printer.trim() } : {}),
    };
    mappedPlateInputs(input);
    return input;
  }
  async function preview() {
    const version = ++previewGeneration.current;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreviewBusy(true);
    try {
      const input = currentInput();
      const result = await api("/orders/preview", previewSchema, {
        ...json(input),
        signal: controller.signal,
      });
      if (version === previewGeneration.current)
        setPayload({
          ...result,
          release: input.release,
          on_filament_mismatch: input.on_filament_mismatch,
          ...(input.printer_id ? { printer_id: input.printer_id } : {}),
        });
    } catch (e) {
      if (version === previewGeneration.current)
        setPayload({ error: message(e) });
    } finally {
      if (version === previewGeneration.current) setPreviewBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    const current = activeRef.current;
    if (!current) return;
    const generation = ++pollGeneration.current;
    clearTimeout(timer.current);
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    try {
      const value = await api(
        `/orders/${encodeURIComponent(current.id)}`,
        orderSchema,
        { signal: controller.signal },
      );
      if (!mounted.current || generation !== pollGeneration.current) return;
      setOrder(value);
      setError("");
      if (
        value.plates.some(
          (receipt) =>
            !["created", "failed", "cancelled"].includes(receipt.status) ||
            shouldPollJob(receipt.jobRead),
        )
      )
        timer.current = setTimeout(() => {
          void refresh();
        }, 1000);
    } catch (e) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        generation === pollGeneration.current
      ) {
        setError(`${message(e)}. Status is unknown. Polling will retry.`);
        timer.current = setTimeout(() => {
          void refresh();
        }, 3000);
      }
    }
  }, []);
  async function submit(automaticConfirmed = false) {
    if (locked.current || !config) return;
    locked.current = true;
    setBusy(true);
    setError("");
    clearTimeout(timer.current);
    try {
      let current = activeRef.current;
      if (!current) {
        const input = currentInput();
        if (release === "automatic" && printer.trim() && !printerName)
          throw new Error("For automatic release, choose the printer through search so the confirmation names its destination.");
        if (release === "automatic" && !automaticConfirmed) {
          setAutomaticConfirmation(printer.trim() ? printerName : "Smart Queue");
          return;
        }
        setAutomaticConfirmation(null);
        let options: RequestInit;
        if (file) {
          const body = new FormData();
          body.set("order", JSON.stringify(input));
          body.set("file", file);
          options = { method: "POST", body };
        } else options = json({ ...input, file: "cube.3mf" });
        current = { id: input.id, plates: input.plates, options };
        setStatusPlate(input.plates[0] ?? 1);
        activeRef.current = current;
        setActive(current);
      }
      if (!current.options) return;
      await api("/orders", acceptedSchema, current.options);
      current.options = null;
      setSubmitted(true);
      await refresh();
    } catch (e) {
      if (activeRef.current) await refresh();
      setError(
        `${message(e)}${activeRef.current ? ". Retry preserves this order ID. Reload to change the input." : ""}`,
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function action(kind: "release" | "cancel", plate = statusPlate) {
    const current = activeRef.current;
    if (!current || locked.current) return;
    locked.current = true;
    setBusy(true);
    clearTimeout(timer.current);
    let failure = "";
    try {
      await api(
        `/orders/${encodeURIComponent(current.id)}/${plate}/${kind}`,
        receiptSchemaForAction,
        { method: "POST" },
      );
    } catch (e) {
      failure = `${message(e)}. Status refreshed; check before retrying this action.`;
    } finally {
      locked.current = false;
      setBusy(false);
      await refresh();
      if (failure) setError(failure);
    }
  }
  return {
    config,
    project,
    extracted,
    file,
    plateNumber,
    selectedPlates,
    statusPlate,
    setStatusPlate,
    plateStatus,
    togglePlate: (number: number, checked: boolean) => {
      setSelectedPlates((previous) =>
        checked
          ? [...new Set([...previous, number])].sort((a, b) => a - b)
          : previous.filter((p) => p !== number),
      );
      if (checked) setPlateNumber(number);
      setBulkNotice("");
      invalidate();
    },
    currentSources,
    sourceGroups,
    chooseGroup,
    groupSelection,
    groupHint: (source: Source, plates: number[]) => hints[plates[0] ?? 0]?.[source.sourceSlot],
    setGroupHint: (source: Source, plates: number[], hint: Hint) => {
      setHints(previous => {
        const next = { ...previous };
        for (const number of plates) next[number] = { ...next[number], [source.sourceSlot]: hint };
        return next;
      });
      invalidate();
    },
    mappingMode,
    setMappingMode,
    confirmSelectedUsage,
    printerName,
    bulkTargets,
    bulkNotice,
    confirmed,
    draft,
    currentUsage,
    showAll: Boolean(showAll[plateNumber]),
    setShowAll: (value: boolean) =>
      setShowAll((p) => ({ ...p, [plateNumber]: value })),
    selections: currentSelections,
    hints: hints[plateNumber] ?? {},
    printer,
    release,
    automaticConfirmation,
    cancelAutomatic: () => setAutomaticConfirmation(null),
    confirmAutomatic: () => submit(true),
    policy,
    manifest,
    projectError,
    extracting,
    active,
    order,
    busy,
    submitted,
    error,
    payload,
    previewBusy,
    complete,
    selectFile,
    editManifest,
    applyManifest,
    importManifest,
    changeUsage,
    confirmUsage,
    applyToMatching,
    preview,
    submit,
    action,
    refresh,
    setPlate: (number: number) => {
      setPlateNumber(number);
      invalidate();
    },
    setPrinter: (value: string, name = "") => {
      setPrinter(value);
      setPrinterName(name);
      invalidate();
    },
    setRelease: (value: string) => {
      setRelease(value);
      invalidate();
    },
    setPolicy: (value: string) => {
      setPolicy(value);
      invalidate();
    },
    choose: (slot: number, material: Material) => {
      setSelections((p) => ({
        ...p,
        [plateNumber]: { ...p[plateNumber], [slot]: material },
      }));
      setBulkNotice("");
      invalidate();
    },
    setHint: (slot: number, hint: Hint) => {
      setHints((p) => ({
        ...p,
        [plateNumber]: { ...p[plateNumber], [slot]: hint },
      }));
      invalidate();
    },
    newOrder: () => window.location.reload(),
  };
}
const receiptSchemaForAction = z.unknown();
export type OrderWorkflow = ReturnType<typeof useOrderWorkflow>;
