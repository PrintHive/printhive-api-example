import { normalizeColor } from './project-data.mjs';

const waitingCauses = new Map([
  ['slot_empty', 'The requested printer slot is empty.'],
  ['missing_material', 'The required material is not loaded.'],
  ['color_distance', 'The loaded filament does not meet the material or color requirements.'],
  ['slot_conflict', 'The printer slots cannot satisfy all filament requirements at the same time.'],
]);

export function waitingFilamentInstructions(reasons) {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) => {
    const sourceSlot = Number.isInteger(reason?.sourceSlot) ? reason.sourceSlot : null;
    const source = sourceSlot === null ? 'Material route' : `Source slot ${sourceSlot}`;
    const material = typeof reason?.material === 'string' ? reason.material : null;
    const color = normalizeColor(reason?.color);
    const cause = typeof reason?.cause === 'string' ? reason.cause : null;
    const target = reason?.suggestedTargetSlot;
    const located = Number.isInteger(target?.ams_id) && Number.isInteger(target?.slot_id);
    const filament = `${material}${color ? ` ${color}` : ''}`;
    let instruction = material ? `Load ${filament} for ${source.toLowerCase()}.` : 'Check the printer material route before this job can be claimed.';
    if (reason?.code === 'material_route_changed') instruction = sourceSlot === null ? 'Check the printer material readings again before changing filament.' : `Check the material reading for ${source.toLowerCase()} again before changing filament.`;
    else if (cause === 'slot_conflict' && material) instruction = located ? `${filament} for ${source.toLowerCase()} competes for this tray. Change the slot assignment.` : `Load another ${filament} spool for ${source.toLowerCase()}; another source slot is using the matching loaded spool.`;
    return {
      source, material, color, cause,
      explanation: cause ? waitingCauses.get(cause) ?? 'Hive reported another material-waiting condition. Check the API waiting reasons.' : null,
      code: typeof reason?.code === 'string' ? reason.code : 'unknown_reason',
      instruction,
      placement: located ? `API target: AMS ${target.ams_id}, slot ${target.slot_id}.` : 'No physical slot supplied. Hive must resolve the material route; the source index is not a printer slot.',
    };
  });
}

export async function readCreatedJob(hive, receipt) {
  if (receipt.status !== 'created') return { kind: 'not_created' };
  if (!receipt.job) return { kind: 'missing' };
  if (typeof hive.printJobs.get !== 'function') return { kind: 'unavailable', code: 'sdk_job_read_unavailable' };
  try {
    const job = await hive.printJobs.get(receipt.job.id);
    return { kind: 'available', job: {
      id: job.id, name: job.name, status: job.status, printer_id: job.printer_id,
      model_file_id: job.model_file_id,
      filament_route_state: job.print_options?.filament_route_state ?? null,
      filament_waiting_reasons: job.print_options?.filament_waiting_reasons ?? [],
    } };
  } catch (error) {
    return error.status === 404 ? { kind: 'missing' } : { kind: 'unavailable', code: [401, 403].includes(error.status) ? 'job_read_forbidden' : 'job_read_failed', upstreamStatus: Number.isInteger(error.status) ? error.status : null };
  }
}

export function shouldPollJob(read) {
  if (read?.kind === 'unavailable') return read.code === 'job_read_failed';
  if (read?.kind !== 'available') return false;
  return !['COMPLETED', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(String(read.job.status).toUpperCase());
}
