import {
  Clock3,
  Printer,
  RefreshCw,
  CircleCheck,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { waitingFilamentInstructions } from "../../src/job-status.mjs";
import { type OrderWorkflow } from "@/lib/use-order-workflow";
import { SdkCall } from "./sdk-call";
import { Color, ReportedColors } from "./color";

const actionSchema = z.object({ code: z.string().optional() });
export function OrderStatus({ flow }: { flow: OrderWorkflow }) {
  const receipt =
    flow.order?.plates.find((p) => p.plate === flow.statusPlate) ??
    flow.order?.plates[0];
  const read = receipt?.jobRead;
  const job = read?.kind === "available" ? read.job : null;
  const reasons = job?.filament_waiting_reasons ?? [];
  const instructions = waitingFilamentInstructions(reasons);
  const settled = receipt
    ? ["created", "failed", "cancelled"].includes(receipt.status)
    : false;
  const releasable =
    receipt?.status === "held" &&
    receipt.requiredActions.some((value) => {
      const parsed = actionSchema.safeParse(value);
      return parsed.success && parsed.data.code === "manual_release_required";
    });
  return (
    <Card className="shadow-none h-fit lg:sticky lg:top-6">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle id="status-heading" className="text-xl">
              Request status
            </CardTitle>
            <CardDescription>
              Follow the request into the queue.
            </CardDescription>
          </div>
          <Clock3 className="size-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-5">
        <SdkCall call="client.printJobs.getCreateRequest(requestId)">
          Polls preparation once per second. A held request needs review; it is
          not a job.
        </SdkCall>
        <SdkCall call="HTTP POST /v1/print-jobs/create-requests/{requestId}/release or /cancel">
          SDK 0.3.2 has no release or cancel helper. This UI offers Release for
          manual holds and Cancel before creation. The backend forwards the
          action. Hive decides whether to accept it.
        </SdkCall>
        <SdkCall call="client.printJobs.get(jobId)">
          After creation, polls live status and unmet filament requirements.
          Creation does not mean printing has started or finished.
        </SdkCall>
        {flow.active && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Selected plate requests</h3>
            <div className="flex flex-wrap gap-2">
              {flow.active.plates.map((plate) => (
                <Button
                  key={plate}
                  type="button"
                  variant={flow.statusPlate === plate ? "secondary" : "outline"}
                  size="sm"
                  disabled={flow.busy}
                  aria-pressed={flow.statusPlate === plate}
                  onClick={() => flow.setStatusPlate(plate)}
                >
                  Plate {plate} ·{" "}
                  {flow.order?.plates.find((p) => p.plate === plate)?.status ??
                    "Awaiting receipt"}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Review and control each plate separately. A retry preserves all
              submitted requests and the remaining plate keys.
            </p>
          </div>
        )}
        {!flow.active && (
          <div id="empty" className="py-8 text-center space-y-4">
            <div className="mx-auto grid size-12 place-content-center rounded-md border bg-muted">
              <Printer className="size-5 text-muted-foreground" />
            </div>
            <p className="font-semibold">Ready when you are</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Submit an order to see its request ID, preparation state and live
              job.
            </p>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <span>Project</span>
              <ArrowRight className="size-3" />
              <span>Preparation</span>
              <ArrowRight className="size-3" />
              <span>Job</span>
            </div>
          </div>
        )}
        {flow.active && (
          <div id="receipt" className="space-y-5">
            <div className="flex items-center justify-between">
              <p
                id="state"
                className="text-3xl font-semibold tracking-tight"
                role="status"
                aria-live="polite"
              >
                {receipt?.status ?? "Awaiting receipt"}
              </p>
              <Badge variant="outline">
                {receipt?.status === "created"
                  ? "Job admitted"
                  : "Creation request"}
              </Badge>
            </div>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground mb-1">Order ID</dt>
                <dd id="order-id" className="font-mono text-xs break-all">
                  {flow.active.id}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground mb-1">
                  Request ID
                </dt>
                <dd id="request-id" className="font-mono text-xs break-all">
                  {receipt?.requestId ?? "Awaiting receipt"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground mb-1">Job ID</dt>
                <dd id="job-id" className="font-mono text-xs">
                  {receipt?.job?.id ?? "—"}
                </dd>
              </div>
            </dl>
            {receipt?.status === "pending_submission" && (
              <p className="text-xs text-muted-foreground">
                This plate has not been submitted yet. Retry the same order to
                resume with its saved key.
              </p>
            )}
            {receipt && (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Required actions</h3>
                  <ReportedColors value={receipt.requiredActions} />
                  <pre id="actions" className="code-panel">
                    {JSON.stringify(receipt.requiredActions, null, 2)}
                  </pre>
                </div>
                {receipt.error != null && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Error</h3>
                    <ReportedColors value={receipt.error} />
                    <pre id="failure" className="code-panel">
                      {JSON.stringify(receipt.error, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
            {receipt?.status === "created" && (
              <div id="job-details" className="space-y-4 border-t pt-5">
                <h3 className="font-semibold flex items-center gap-2">
                  <CircleCheck className="size-4" />
                  Created job
                </h3>
                {job ? (
                  <>
                    <p
                      id="job-state"
                      className="text-xl font-semibold"
                      role="status"
                    >
                      {job.status}
                    </p>
                    <p
                      id="job-printer"
                      className="text-xs text-muted-foreground break-all"
                    >
                      {job.printer_id
                        ? `Assigned printer: ${job.printer_id}`
                        : "Smart Queue will choose the physical printer and placement."}
                    </p>
                    <h3 className="text-sm font-semibold">
                      Filament readiness
                    </h3>
                    <p
                      id="waiting-summary"
                      className="text-xs leading-relaxed text-muted-foreground"
                    >
                      {instructions.length
                        ? "Hive reports these filament checks. Source slots identify project filaments; only an API-supplied target identifies a printer tray."
                        : job.filament_route_state === "waiting"
                          ? "Hive is still resolving the material route. No loading details are available yet."
                          : "No filament waiting reasons are reported. Printer readiness and claim checks still apply."}
                    </p>
                    <div
                      id="waiting-reasons"
                      aria-label="Job filament waiting reasons"
                      className="space-y-3"
                    >
                      {instructions.map((instruction, index) => (
                        <div
                          key={index}
                          className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm"
                        >
                          <p className="font-semibold">{instruction.source}</p>
                          <p>{instruction.instruction}</p>
                          {instruction.explanation && (
                            <p className="text-xs text-muted-foreground waiting-cause">
                              {instruction.explanation}
                            </p>
                          )}
                          {instruction.color && (
                            <Color value={instruction.color} />
                          )}
                          <p className="text-xs text-muted-foreground">
                            {instruction.placement}
                          </p>
                          <code className="text-[11px] break-all">
                            {instruction.code}
                          </code>
                        </div>
                      ))}
                    </div>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        API job waiting reasons
                      </summary>
                      <pre id="waiting-json" className="code-panel mt-2">
                        {JSON.stringify(reasons, null, 2)}
                      </pre>
                    </details>
                  </>
                ) : (
                  <p
                    id="job-read-error"
                    role="status"
                    className="rounded-md border p-3 text-sm"
                  >
                    {read?.kind === "missing"
                      ? "The job is no longer available. The original creation receipt remains valid."
                      : read?.kind === "unavailable" &&
                          read.code === "sdk_job_read_unavailable"
                        ? "This SDK cannot read jobs. Install the updated SDK build to follow filament waiting."
                        : read?.kind === "unavailable" &&
                            read.code === "job_read_forbidden"
                          ? `Job access was refused with HTTP ${read.upstreamStatus}. Check the server credential before refreshing. Creation succeeded; do not resubmit.`
                          : "The job snapshot could not be read. Creation succeeded; refresh status instead of submitting another job."}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {releasable && (
                <Button
                  id="release"
                  type="button"
                  disabled={flow.busy}
                  onClick={() => void flow.action("release")}
                >
                  Release
                </Button>
              )}
              {!settled && receipt?.requestId && (
                <Button
                  id="cancel"
                  type="button"
                  variant="outline"
                  disabled={flow.busy}
                  onClick={() => void flow.action("cancel")}
                >
                  Cancel
                </Button>
              )}
              <Button
                id="refresh"
                type="button"
                variant="outline"
                disabled={flow.busy}
                onClick={() => void flow.refresh()}
              >
                <RefreshCw className="size-3" />
                Refresh status
              </Button>
            </div>
          </div>
        )}
        {flow.error && (
          <div
            id="error"
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm flex gap-2"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p>{flow.error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
