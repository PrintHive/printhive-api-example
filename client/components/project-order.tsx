import {
  Upload,
  FileBox,
  ArrowRight,
  Braces,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { type OrderWorkflow } from "@/lib/use-order-workflow";
import { Color, ReportedColors } from "./color";
import { SdkCall } from "./sdk-call";
import { PlateSelector } from "./plate-selector";
import { PrinterSearch } from "./printer-search";
import { FilamentMapping } from "./filament-mapping";

export function ProjectOrder({ flow }: { flow: OrderWorkflow }) {
  const disabled = flow.busy || Boolean(flow.active);
  const availablePlates = flow.extracted?.plates ?? flow.project?.plates ?? [];
  const detected = flow.currentUsage?.kind === "detected";
  const shown =
    flow.extracted?.palette.filter(
      (f) =>
        !detected ||
        flow.showAll ||
        flow.currentUsage?.sourceSlots?.includes(f.sourceSlot) ||
        flow.draft.includes(f.sourceSlot),
    ) ?? [];
  const canConfirm = Boolean(
    flow.extracted &&
    flow.draft.length &&
    flow.draft.every((slot) =>
      flow.extracted?.palette.some(
        (f) => f.sourceSlot === slot && f.selectable,
      ),
    ),
  );
  let manifestData: unknown;
  try {
    manifestData = JSON.parse(flow.manifest);
  } catch {
    manifestData = null;
  }
  return (
    <Card className="border-border shadow-none">
      <CardHeader className="border-b">
        <div className="flex items-center gap-3">
          <span className="step-index">01</span>
          <div>
            <CardTitle className="text-xl">Prepare your order</CardTitle>
            <CardDescription>
              One project, selected plates, independent filament requirements.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form
          id="order-form"
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!flow.submitted) void flow.submit();
          }}
        >
          <SdkCall call="Local upload and plate inspection">
            Plate inspection makes no SDK call. Hive receives the file on
            submission through client.printJobs.create below.
          </SdkCall>
          <fieldset
            id="intent-fields"
            disabled={disabled}
            className="space-y-6 min-w-0"
          >
            <div className="space-y-2">
              <Label htmlFor="file" className="flex items-center gap-2">
                <FileBox className="size-4" />
                Project 3MF
              </Label>
              <div className="rounded-md border border-dashed bg-muted/30 p-4 space-y-3">
                <Input
                  id="file"
                  type="file"
                  accept=".3mf"
                  onChange={(e) =>
                    void flow.selectFile(e.target.files?.[0] ?? null)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Choose a project to extract its plate numbers and palette.
                  Leave empty for the bundled cube. Maximum 16 MiB including
                  form data.
                </p>
              </div>
            </div>
            {availablePlates.length > 0 && (
              <PlateSelector
                key={flow.project?.sha256 ?? "loading"}
                plates={availablePlates}
                selected={flow.selectedPlates}
                focused={flow.plateNumber}
                disabled={disabled || flow.extracting}
                status={flow.plateStatus}
                focus={flow.setPlate}
                toggle={flow.togglePlate}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="release-mode">Release mode</Label>
                <NativeSelect
                  id="release-mode"
                  value={flow.release}
                  onChange={(e) => flow.setRelease(e.target.value)}
                >
                  <NativeSelectOption value="manual">
                    Manual · review first
                  </NativeSelectOption>
                  <NativeSelectOption value="automatic">
                    Auto · queue when ready
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <p
              id="project-summary"
              className="text-sm text-muted-foreground"
              role="status"
            >
              {flow.extracting
                ? "Reading plates and filament palette…"
                : flow.project
                  ? `${flow.project.filename} · ${availablePlates.length} plate${availablePlates.length === 1 ? "" : "s"}${flow.extracted ? " extracted" : ""}`
                  : "Choose a supported project or supply known plate data below."}
            </p>
            {flow.projectError && (
              <p
                id="project-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {flow.projectError}
              </p>
            )}
            <details id="project-editor" className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
                <Braces className="size-4" />
                Advanced: supply known plate data
              </summary>
              <div className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Replace extracted candidates with source usage your
                  application has already resolved. This does not clear Hive
                  inspection holds.
                </p>
                <Label htmlFor="manifest-file">Import project data JSON</Label>
                <Input
                  id="manifest-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) =>
                    void flow.importManifest(e.target.files?.[0] ?? null)
                  }
                />
                <Label htmlFor="manifest">Plate and source filament data</Label>
                <Textarea
                  id="manifest"
                  rows={9}
                  spellCheck={false}
                  value={flow.manifest}
                  className="font-mono text-xs"
                  onChange={(e) => flow.editManifest(e.target.value)}
                />
                <ReportedColors value={manifestData} />
                <Button
                  id="apply-manifest"
                  type="button"
                  variant="outline"
                  onClick={() => void flow.applyManifest()}
                >
                  Use project data
                </Button>
              </div>
            </details>
            {flow.extracted && (
              <fieldset
                id="source-usage"
                className="rounded-md border bg-muted/25 p-4 space-y-4 min-w-0"
              >
                <legend className="px-1 text-sm font-semibold">
                  Source filaments used on this plate
                </legend>
                <p
                  id="usage-warning"
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {detected
                    ? "From saved slice metadata; confirm usage. Saved metadata can be stale. "
                    : "Plate usage is unresolved, so the full project palette is shown. "}
                  {flow.extracted.warnings.join(" ")}
                </p>
                {detected && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id="show-all-filaments"
                      checked={flow.showAll}
                      onCheckedChange={(value) =>
                        flow.setShowAll(value === true)
                      }
                    />
                    Show all project filaments
                  </label>
                )}
                <div id="source-palette" className="space-y-2">
                  {shown.map((f) => (
                    <label
                      key={f.sourceSlot}
                      className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-3 text-sm"
                    >
                      <Checkbox
                        data-palette-slot={f.sourceSlot}
                        checked={flow.draft.includes(f.sourceSlot)}
                        disabled={!f.selectable || disabled}
                        onCheckedChange={(value) =>
                          flow.changeUsage(f.sourceSlot, value === true)
                        }
                      />
                      <span>
                        Source slot {f.sourceSlot} ·{" "}
                        {f.material || "Unknown material"}
                      </span>
                      <Color value={f.color} />
                      {!f.selectable && (
                        <span className="text-xs text-muted-foreground">
                          {f.unavailableReason}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <Button
                  id="confirm-usage"
                  type="button"
                  variant="outline"
                  disabled={!canConfirm || disabled}
                  onClick={flow.confirmUsage}
                >
                  Use these source filaments
                </Button>
                <p
                  id="usage-status"
                  className="text-xs text-muted-foreground"
                  role="status"
                >
                  {flow.confirmed[flow.plateNumber]
                    ? `Source filaments confirmed for plate ${flow.plateNumber}.`
                    : `Confirm the source filaments used on plate ${flow.plateNumber}. No material usage has been assumed.`}
                </p>
              </fieldset>
            )}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="step-index">02</span>
                <h3 className="font-semibold">
                  Map plate {flow.plateNumber} filament requirements
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Choose one Hive filament per source. Job matching uses material
                type and color, not exact SKU identity. Smart Queue resolves
                physical placement.
              </p>
              <div id="filaments" className="space-y-4">
                {flow.extracted &&
                  !flow.confirmed[flow.plateNumber] &&
                  flow.currentSources.length > 0 && (
                    <p
                      id="mapping-pending"
                      className="text-xs text-muted-foreground"
                      role="status"
                    >
                      Usage for plate {flow.plateNumber} is not confirmed yet.
                      Choices stay with these source slots; confirm usage above
                      before submitting.
                    </p>
                  )}
                {flow.currentSources.map((source) => (
                  <FilamentMapping
                    key={`${flow.project?.sha256}-${flow.plateNumber}-${source.sourceSlot}`}
                    source={source}
                    plateNumber={flow.plateNumber}
                    selected={flow.selections[source.sourceSlot]}
                    hint={flow.hints[source.sourceSlot]}
                    printer={flow.printer}
                    disabled={disabled}
                    choose={(value) => flow.choose(source.sourceSlot, value)}
                    setHint={(value) => flow.setHint(source.sourceSlot, value)}
                    bulkTargets={flow.bulkTargets(source.sourceSlot)}
                    applyToTargets={() =>
                      flow.applyToMatching(source.sourceSlot)
                    }
                  />
                ))}
                {!flow.currentSources.length && (
                  <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
                    Select the source filaments above to assign requirements.
                    Confirm usage before submitting.
                  </p>
                )}
                {flow.bulkNotice && (
                  <p
                    id="bulk-status"
                    className="text-xs text-muted-foreground"
                    role="status"
                  >
                    {flow.bulkNotice}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-4 border-t pt-5">
              <div className="flex items-center gap-3">
                <span className="step-index">03</span>
                <h3 className="font-semibold">Choose the destination</h3>
              </div>
              <PrinterSearch disabled={disabled} choose={flow.setPrinter} />
              <div className="space-y-2">
                <Label htmlFor="printer">Printer ID (optional)</Label>
                <Input
                  id="printer"
                  placeholder="Leave empty for Smart Queue"
                  value={flow.printer}
                  onChange={(e) => flow.setPrinter(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  A named printer stays assigned to this job. Use a mock printer
                  for automated tests.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="filament-mismatch">
                  When the named printer is missing filament
                </Label>
                <NativeSelect
                  id="filament-mismatch"
                  value={flow.policy}
                  onChange={(e) => flow.setPolicy(e.target.value)}
                >
                  <NativeSelectOption value="wait">
                    Wait · report loading requirements
                  </NativeSelectOption>
                  <NativeSelectOption value="reject">
                    Reject · refuse a mismatch
                  </NativeSelectOption>
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  A created job may still wait for materials, printer readiness
                  or plate-selection support.
                </p>
              </div>
            </div>
          </fieldset>
          <SdkCall call="client.printJobs.create({ file, filename, plate, filaments, printer_id, release, idempotencyKey })">
            Hive uploads, inspects, and cloud-slices each selected plate in a
            separate SDK request. The server resolves catalog IDs to material
            and color requirements. The server saves the key before submission
            so an unchanged retry keeps the same request.
          </SdkCall>
          <div className="space-y-3 border-t pt-5">
            <Button
              id="preview"
              type="button"
              variant="outline"
              disabled={
                disabled || !flow.config || !flow.complete || flow.previewBusy
              }
              onClick={() => void flow.preview()}
            >
              {flow.previewBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Braces className="size-4" />
              )}
              Preview API request
            </Button>
            <ReportedColors value={flow.payload} />
            <pre
              id="payload"
              aria-label="API request preview"
              className="code-panel"
            >
              {flow.previewBusy
                ? "Resolving catalog requirements…"
                : flow.payload
                  ? JSON.stringify(flow.payload, null, 2)
                  : "Choose a Hive requirement for every source filament on every selected plate, then preview the API requests."}
            </pre>
            <Button
              id="submit"
              type={flow.submitted ? "button" : "submit"}
              variant={flow.submitted ? "outline" : "default"}
              className="w-full"
              disabled={
                flow.busy || !flow.config || (!flow.active && !flow.complete)
              }
              onClick={flow.submitted ? flow.newOrder : undefined}
            >
              {flow.busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : flow.submitted ? (
                <Upload className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {flow.busy
                ? "Submitting order…"
                : flow.submitted
                  ? "Start another order"
                  : flow.active
                    ? "Retry same order"
                    : "Submit order"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
