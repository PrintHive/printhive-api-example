import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { normalizeColor } from './project-data.mjs';

const MAX_ENTRIES = 1000;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 8 * 1024 * 1024;
const previewPath = /^metadata\/plate_[1-9]\d*\.png$/;
const documents = new Set(['metadata/project_settings.config', 'metadata/model_settings.config']);
const invalid = (message) => new Error(message);
function entryName(entry) {
  const name = entry.fileName;
  const parts = name.replace(/\/$/, '').split('/');
  if (name.length > 1024 || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || parts.some((part) => !part || part === '.' || part === '..') || name.includes('\0')) throw invalid('Project archive contains an unsafe path');
  if (entry.generalPurposeBitFlag & 1) throw invalid('Encrypted project archives are not supported');
  if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw invalid('Project archive links are not supported');
  return name.toLowerCase();
}
function readDocument(zip, entry, budget, optional) {
  if (entry.uncompressedSize > MAX_DOCUMENT_BYTES) throw invalid('Project metadata exceeds the 4 MiB document limit');
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(invalid('Project metadata cannot be decompressed'));
      const chunks = []; let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length; budget.bytes += chunk.length;
        if (budget.bytes > MAX_METADATA_BYTES) stream.destroy(invalid('Project metadata exceeds the 16 MiB combined inflation limit'));
        else if (size > MAX_DOCUMENT_BYTES) stream.destroy(invalid('Project metadata exceeds the 4 MiB document limit'));
        else chunks.push(chunk);
      });
      stream.once('error', () => reject(invalid('Project metadata is invalid or exceeds its size limit')));
      stream.once('end', () => {
        try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { if (optional) resolve('\0'); else reject(invalid('Project metadata must be UTF-8')); }
      });
    });
  });
}
function readPreview(zip, entry, budget) {
  if (entry.uncompressedSize > MAX_PREVIEW_BYTES || budget.bytes + entry.uncompressedSize > MAX_PREVIEW_TOTAL_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return resolve(null);
      const chunks = []; let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length; budget.bytes += chunk.length;
        if (size > MAX_PREVIEW_BYTES || budget.bytes > MAX_PREVIEW_TOTAL_BYTES) stream.destroy(new Error('Preview limit'));
        else chunks.push(chunk);
      });
      stream.once('error', () => resolve(null));
      stream.once('end', () => {
        const bytes = Buffer.concat(chunks);
        const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return resolve(null);
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        if (!width || !height || width > 2048 || height > 2048 || width * height > 4 * 1024 * 1024) return resolve(null);
        let offset = 8, pixels = false, ended = false;
        while (offset + 12 <= bytes.length) {
          const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
          if (length > bytes.length - offset - 12) return resolve(null);
          if (type === 'IDAT') pixels = true;
          offset += length + 12;
          if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
        }
        resolve(pixels && ended ? `data:image/png;base64,${bytes.toString('base64')}` : null);
      });
    });
  });
}
function readMetadata(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(invalid('Choose a valid ZIP-based 3MF project'));
      let count = 0; let done = false;
      const names = new Set(); const result = new Map(); const budget = { bytes: 0 }; const previewBudget = { bytes: 0 };
      function fail(reason) { if (done) return; done = true; zip.close(); reject(reason); }
      zip.once('error', () => fail(invalid('Project archive is malformed')));
      zip.on('entry', (entry) => {
        Promise.resolve().then(async () => {
          if (++count > MAX_ENTRIES) throw invalid('Project archive exceeds the 1000-entry limit');
          const name = entryName(entry);
          if (names.has(name)) throw invalid('Project archive contains duplicate paths');
          names.add(name);
          if (documents.has(name) || name === 'metadata/slice_info.config' || /^metadata\/plate_[1-9]\d*\.json$/.test(name)) result.set(name, await readDocument(zip, entry, budget, !documents.has(name)));
          else if (previewPath.test(name)) result.set(name, await readPreview(zip, entry, previewBudget));
          if (!done) zip.readEntry();
        }).catch(fail);
      });
      zip.once('end', () => {
        if (done) return;
        done = true; zip.close();
        if (!result.has('metadata/model_settings.config')) return reject(invalid('This demo needs Bambu model_settings.config metadata to identify plates'));
        resolve(result);
      });
      zip.readEntry();
    });
  });
}
function paletteFrom(text) {
  if (text === undefined) return [];
  let settings;
  try { settings = JSON.parse(text); } catch { throw invalid('Project settings are not valid JSON'); }
  const types = Array.isArray(settings?.filament_type) ? settings.filament_type : [];
  const colors = Array.isArray(settings?.filament_colour) ? settings.filament_colour : [];
  if (Math.max(types.length, colors.length) > 256) throw invalid('Project palette exceeds the 256-filament limit');
  return Array.from({ length: Math.max(types.length, colors.length) }, (_, sourceSlot) => {
    const material = typeof types[sourceSlot] === 'string' ? types[sourceSlot].trim() : '';
    const color = normalizeColor(colors[sourceSlot]);
    const selectable = material.length > 0 && material.length <= 100 && color !== null;
    return { sourceSlot, name: `Project filament ${sourceSlot + 1}`, material, color, selectable, unavailableReason: selectable ? null : 'This palette entry needs a material type and a six-digit hex color; use advanced project data to supply known values' };
  });
}
function platesFrom(text) {
  const plates = []; const numbers = new Set(); const stack = [];
  let current; let count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw invalid('Project XML cannot contain a DTD or entities'); });
  parser.on('error', () => { throw invalid('Project plate metadata is not valid XML'); });
  parser.on('opentag', (tag) => {
    if (++count > 64000 || stack.length >= 64) throw invalid('Project XML exceeds its structure limits');
    const parent = stack.at(-1); stack.push(tag.local);
    if (tag.local === 'plate') {
      if (current) throw invalid('Nested plate metadata is not supported');
      current = { number: null, name: '', thumbnail: null };
    }
    if (current && tag.local === 'metadata' && parent === 'plate') {
      const attributes = Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]));
      if (attributes.key === 'plater_name') current.name = (attributes.value ?? '').slice(0, 200);
      if (attributes.key === 'thumbnail_file') { const path = (attributes.value ?? '').toLowerCase(); current.thumbnail = previewPath.test(path) ? path : ''; }
      if (attributes.key === 'plater_id') {
        if (current.number !== null || !/^[1-9]\d*$/.test(attributes.value ?? '')) throw invalid('Plate metadata has an invalid plate number');
        const number = Number(attributes.value);
        if (!Number.isSafeInteger(number) || number > 256) throw invalid('Plate numbers must be between 1 and 256');
        current.number = number;
      }
    }
  });
  parser.on('closetag', (tag) => {
    if (tag.local === 'plate') {
      if (!current?.number || numbers.has(current.number) || plates.length >= 256) throw invalid('Plate metadata needs unique plate numbers');
      numbers.add(current.number); plates.push({ ...current }); current = null;
    }
    stack.pop();
  });
  parser.write(text).close();
  if (!plates.length) throw invalid('No plate metadata was found; this demo does not guess a plate number');
  return plates.sort((a, b) => a.number - b.number);
}
function usageSlots(values, paletteSize) {
  if (!Array.isArray(values)) return { kind: 'unknown', reason: 'invalid_usage_metadata' };
  if (!values.length) return { kind: 'unknown', reason: 'empty_usage_metadata' };
  if (values.length > 256 || values.some((slot) => !Number.isInteger(slot) || slot < 0 || slot >= paletteSize) || new Set(values).size !== values.length)
    return { kind: 'unknown', reason: 'invalid_usage_metadata' };
  return { kind: 'detected', sourceSlots: [...values].sort((a, b) => a - b) };
}
function paletteMatches(slot, fields, palette) {
  const source = palette[slot];
  if (fields.type !== undefined && fields.type !== '' && String(fields.type).trim().toUpperCase() !== source.material.toUpperCase()) return false;
  if (fields.color !== undefined && fields.color !== '' && normalizeColor(fields.color) !== source.color) return false;
  return true;
}
function plateJsonUsage(text, palette) {
  if (text === undefined) return { kind: 'unknown', reason: 'missing_usage_metadata' };
  let data;
  try { data = JSON.parse(text); } catch { return { kind: 'unknown', reason: 'invalid_usage_metadata' }; }
  const usage = usageSlots(data?.filament_ids, palette.length);
  if (usage.kind !== 'detected') return usage;
  if (data.filament_colors !== undefined) {
    if (!Array.isArray(data.filament_colors)) return { kind: 'unknown', reason: 'invalid_usage_metadata' };
    if (data.filament_colors.length && (data.filament_colors.length !== data.filament_ids.length || data.filament_ids.some((slot, i) => !paletteMatches(slot, { color: data.filament_colors[i] }, palette))))
      return { kind: 'unknown', reason: 'conflicting_usage_metadata' };
  }
  return usage;
}
function sliceInfoUsage(text, palette) {
  if (text === undefined) return { plates: new Map(), invalid: false };
  const plates = new Map(); const stack = [];
  let current; let count = 0; let unsafe = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { unsafe = true; throw invalid('Project XML cannot contain a DTD or entities'); });
  parser.on('error', () => { throw invalid('Saved slice metadata is not valid XML'); });
  parser.on('opentag', (tag) => {
    if (++count > 64000 || stack.length >= 64) { unsafe = true; throw invalid('Project XML exceeds its structure limits'); }
    const parent = stack.at(-1); stack.push(tag.local);
    const attributes = Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]));
    if (tag.local === 'plate') {
      if (current) throw invalid('Nested saved plate metadata is not supported');
      current = { number: null, filaments: [], mixed: false };
    }
    if (!current) return;
    if (tag.local === 'mixed_filament') current.mixed = true;
    if (tag.local === 'filament' && parent === 'plate') current.filaments.push(attributes);
    if (tag.local === 'metadata' && parent === 'plate' && attributes.key === 'index') {
      if (current.number !== null || !/^[1-9]\d*$/.test(attributes.value ?? '')) throw invalid('Invalid saved plate index');
      current.number = Number(attributes.value);
    }
  });
  parser.on('closetag', (tag) => {
    if (tag.local === 'plate') {
      if (!Number.isInteger(current?.number) || current.number < 1 || current.number > 256 || plates.has(current.number)) throw invalid('Invalid or duplicate saved plate index');
      let usage;
      if (current.mixed) usage = { kind: 'unknown', reason: 'mixed_filament_metadata' };
      else {
        const values = current.filaments.map((f) => /^[1-9]\d*$/.test(f.id ?? '') ? Number(f.id) - 1 : NaN);
        usage = usageSlots(values, palette.length);
        if (usage.kind === 'detected') {
          const weights = current.filaments.map((f) => {
            const raw = [f.used_g, f.used_m].filter((value) => value !== undefined);
            if (!raw.length || raw.some((value) => !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0)) return null;
            return raw.some((value) => Number(value) > 0);
          });
          if (weights.some((weight) => weight === null)) usage = { kind: 'unknown', reason: 'invalid_usage_metadata' };
          else if (current.filaments.some((f, i) => !paletteMatches(values[i], f, palette))) usage = { kind: 'unknown', reason: 'conflicting_usage_metadata' };
          else usage = usageSlots(values.filter((_slot, i) => weights[i]), palette.length);
        }
      }
      plates.set(current.number, usage); current = null;
    }
    stack.pop();
  });
  try { parser.write(text).close(); }
  catch (error) { if (unsafe) throw error; return { plates: new Map(), invalid: true }; }
  return { plates, invalid: false };
}
function detectedPlateUsage(plate, metadata, palette, sliceInfo) {
  const json = plateJsonUsage(metadata.get(`metadata/plate_${plate.number}.json`), palette);
  const slice = sliceInfo.invalid ? { kind: 'unknown', reason: 'invalid_usage_metadata' } : (sliceInfo.plates.get(plate.number) ?? { kind: 'unknown', reason: 'missing_usage_metadata' });
  const problem = [json, slice].find((candidate) => candidate.kind === 'unknown' && !['empty_usage_metadata', 'missing_usage_metadata'].includes(candidate.reason));
  if (problem) return problem;
  if (json.kind === 'detected' && slice.kind === 'detected' && JSON.stringify(json.sourceSlots) !== JSON.stringify(slice.sourceSlots)) return { kind: 'unknown', reason: 'conflicting_usage_metadata' };
  if (json.kind === 'detected') return { ...json, evidence: slice.kind === 'detected' ? 'plate_json_and_slice_info' : 'plate_json' };
  if (slice.kind === 'detected') return { ...slice, evidence: 'slice_info' };
  return json.reason === 'empty_usage_metadata' ? json : slice;
}
export async function inspectProject(bytes, filename) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw invalid('Choose a nonempty 3MF within the 16 MiB upload limit');
  const metadata = await readMetadata(bytes);
  const palette = paletteFrom(metadata.get('metadata/project_settings.config'));
  const sliceInfo = sliceInfoUsage(metadata.get('metadata/slice_info.config'), palette);
  const plates = platesFrom(metadata.get('metadata/model_settings.config')).map(({ number, name, thumbnail }) => ({ number, name, preview: thumbnail !== null && thumbnail !== `metadata/plate_${number}.png` ? null : metadata.get(`metadata/plate_${number}.png`) ?? null, usage: detectedPlateUsage({ number }, metadata, palette, sliceInfo) }));
  const warnings = ['This demo extracted plate numbers and the project palette. It does not decode painted material usage. Confirm which source filaments are used on each selected plate. This confirmation does not clear Hive inspection holds.'];
  if (!palette.length || palette.some((f) => !f.selectable)) warnings.push('Some project palette data is missing or incomplete. Plate choices are still available; supply the known source filaments under Advanced.');
  return {
    filename, sha256: createHash('sha256').update(bytes).digest('hex'),
    plates,
    palette,
    requiresUsageConfirmation: true,
    usageEvidence: plates.some((plate) => plate.usage.kind === 'detected') ? 'saved_slice_metadata' : 'palette_only',
    warnings,
  };
}
