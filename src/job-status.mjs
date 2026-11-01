export function waitingFilamentInstructions(reasons) {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) => {
    const source = Number.isInteger(reason?.sourceSlot) ? `Source slot ${reason.sourceSlot}` : 'Material route';
    const material = typeof reason?.material === 'string' ? reason.material : null;
    const color = typeof reason?.color === 'string' && /^#[a-f0-9]{6}$/i.test(reason.color) ? reason.color : null;
    const target = reason?.suggestedTargetSlot;
    const located = Number.isInteger(target?.ams_id) && Number.isInteger(target?.slot_id);
    return {
      source, material, color,
      code: typeof reason?.code === 'string' ? reason.code : 'unknown_reason',
      instruction: material ? `Load ${material}${color ? ` ${color}` : ''} for ${source.toLowerCase()}.` : 'Check the printer material route before this job can be claimed.',
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
