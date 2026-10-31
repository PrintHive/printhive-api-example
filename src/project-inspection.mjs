import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { normalizeColor } from './project-data.mjs';

const MAX_ENTRIES = 1000;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
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
function readDocument(zip, entry) {
  if (entry.uncompressedSize > MAX_DOCUMENT_BYTES) throw invalid('Project metadata exceeds the 4 MiB document limit');
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(invalid('Project metadata cannot be decompressed'));
      const chunks = []; let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) stream.destroy(invalid('Project metadata exceeds the 4 MiB document limit'));
        else chunks.push(chunk);
      });
      stream.once('error', () => reject(invalid('Project metadata is invalid or exceeds its size limit')));
      stream.once('end', () => {
        try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(invalid('Project metadata must be UTF-8')); }
      });
    });
  });
}
function readMetadata(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(invalid('Choose a valid ZIP-based 3MF project'));
      let count = 0; let done = false;
      const names = new Set(); const result = new Map();
      function fail(reason) { if (done) return; done = true; zip.close(); reject(reason); }
      zip.once('error', () => fail(invalid('Project archive is malformed')));
      zip.on('entry', (entry) => {
        Promise.resolve().then(async () => {
          if (++count > MAX_ENTRIES) throw invalid('Project archive exceeds the 1000-entry limit');
          const name = entryName(entry);
          if (names.has(name)) throw invalid('Project archive contains duplicate paths');
          names.add(name);
          if (documents.has(name)) result.set(name, await readDocument(zip, entry));
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
      current = { number: null };
    }
    if (current && tag.local === 'metadata' && parent === 'plate') {
      const attributes = Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]));
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
      numbers.add(current.number); plates.push({ number: current.number }); current = null;
    }
    stack.pop();
  });
  parser.write(text).close();
  if (!plates.length) throw invalid('No plate metadata was found; this demo does not guess a plate number');
  return plates.sort((a, b) => a.number - b.number);
}
export async function inspectProject(bytes, filename) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw invalid('Choose a nonempty 3MF within the 16 MiB upload limit');
  const metadata = await readMetadata(bytes);
  const palette = paletteFrom(metadata.get('metadata/project_settings.config'));
  const warnings = ['This demo extracted plate numbers and the project palette. It does not decode painted material usage. Confirm which source filaments are used on each selected plate. This confirmation does not clear Hive inspection holds.'];
  if (!palette.length || palette.some((f) => !f.selectable)) warnings.push('Some project palette data is missing or incomplete. Plate choices are still available; supply the known source filaments under Advanced.');
  return {
    filename, sha256: createHash('sha256').update(bytes).digest('hex'),
    plates: platesFrom(metadata.get('metadata/model_settings.config')),
    palette,
    requiresUsageConfirmation: true,
    usageEvidence: 'palette_only',
    warnings,
  };
}
