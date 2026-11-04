import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectProject } from '../src/project-inspection.mjs';

test('saved plate PNG previews retain exact sparse plate identities and names', async () => {
  const result = await inspectProject(await readFile('test/fixtures/plate-previews/valid.3mf'), 'plates.3mf');
  assert.deepEqual(result.plates.map(({ number, name }) => ({ number, name })), [{ number: 2, name: 'Red square' }, { number: 7, name: 'Blue square' }]);
  for (const plate of result.plates) assert.match(plate.preview, /^data:image\/png;base64,iVBOR/);
  assert.notEqual(result.plates[0].preview, result.plates[1].preview);
});

test('missing, malformed, excessive and unsafe previews never hide plate choices or become URLs', async () => {
  for (const name of ['invalid', 'missing', 'oversized', 'unsafe-reference', 'oversized-dimensions', 'cross-plate']) {
    const result = await inspectProject(await readFile(`test/fixtures/plate-previews/${name}.3mf`), `${name}.3mf`);
    assert.deepEqual(result.plates.map(p => p.number), [2, 7]);
    assert.equal(result.plates[0].preview, null, name);
    assert.match(result.plates[1].preview, /^data:image\/png;base64,/);
  }
});
