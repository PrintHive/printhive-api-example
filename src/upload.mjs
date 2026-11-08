import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { basename, join } from 'node:path';

export async function readUpload(req, directory, maxBytes) {
  const tooLarge = () => Object.assign(new Error('Upload exceeds 150 MiB or 64 KiB of metadata'), { status: 413 });
  if (Number(req.headers['content-length']) > maxBytes + 65536) throw tooLarge();
  const parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 1, parts: 3, fileSize: maxBytes + 1, fieldSize: 60000 } });
  let file, filename, order, size = 0, failure;
  const writes = [];
  parser.on('file', (name, stream, info) => {
    filename = basename(info.filename.replaceAll('\\', '/'));
    if (name !== 'file' || !/\.3mf$/i.test(filename)) {
      failure = new Error('Upload one nonempty .3mf project');
      stream.resume();
      return;
    }
    file = join(directory, filename);
    stream.on('limit', () => { failure = tooLarge(); });
    stream.on('data', chunk => { size += chunk.length; if (size > maxBytes) failure = tooLarge(); });
    writes.push(pipeline(stream, createWriteStream(file, { mode: 0o600 })).catch(error => { failure = error; }));
  });
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated) failure = tooLarge();
    else if (name !== 'order') failure = new Error('Unexpected upload field');
    else order = value;
  });
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(event, () => { failure = tooLarge(); });
  let total = 0;
  const bound = new Transform({ transform(chunk, encoding, callback) {
    total += chunk.length;
    callback(total > maxBytes + 65536 ? tooLarge() : null, chunk);
  } });
  try { await pipeline(req, bound, parser); }
  finally { await Promise.all(writes); }
  if (failure) throw failure;
  if (!file || !size) throw new Error('Upload one nonempty .3mf project');
  return { file, filename, order };
}
