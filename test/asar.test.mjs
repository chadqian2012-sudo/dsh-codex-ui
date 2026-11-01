import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MAX_ASAR_ENTRY_BYTES, readAsarEntry } from './browser-fixture.mjs';

function archive(entry, payload = Buffer.from('hello')) {
  const json = Buffer.from(JSON.stringify({ files: { nested: { files: { 'entry.js': entry } } } }));
  const padding = (4 - json.length % 4) % 4;
  const prelude = Buffer.alloc(16);
  const headerSize = 8 + json.length + padding;
  prelude.writeUInt32LE(4, 0);
  prelude.writeUInt32LE(headerSize, 4);
  prelude.writeUInt32LE(headerSize - 4, 8);
  prelude.writeUInt32LE(json.length, 12);
  return Buffer.concat([prelude, json, Buffer.alloc(padding), payload]);
}

function file(t, contents) {
  const filename = path.join(os.tmpdir(), `dsh-asar-${randomUUID()}.asar`);
  fs.writeFileSync(filename, contents, { flag: 'wx' });
  t.after(() => fs.unlinkSync(filename));
  return filename;
}

test('reads standard decimal-string offsets, pickle padding, numeric offsets and empty files', (t) => {
  const standard = file(t, archive({ size: 5, offset: '2' }, Buffer.from('xxhello')));
  assert.equal(readAsarEntry('nested/entry.js', standard).toString(), 'hello');
  const numeric = file(t, archive({ size: 5, offset: 0 }));
  assert.equal(readAsarEntry('nested/entry.js', numeric).toString(), 'hello');
  const empty = file(t, archive({ size: 0, offset: '0' }, Buffer.alloc(0)));
  assert.equal(readAsarEntry('nested/entry.js', empty).length, 0);
});

test('rejects oversized declarations before allocating entry memory', (t) => {
  const oversized = file(t, archive({ size: MAX_ASAR_ENTRY_BYTES + 1, offset: '0' }));
  const outOfFile = file(t, archive({ size: MAX_ASAR_ENTRY_BYTES, offset: '0' }));
  const alloc = Buffer.alloc;
  const sizes = [];
  t.mock.method(Buffer, 'alloc', (size, ...args) => {
    sizes.push(size);
    assert.ok(size < 1024 * 1024, 'malformed tiny archives must fail before large allocation');
    return alloc(size, ...args);
  });
  assert.throws(() => readAsarEntry('nested/entry.js', oversized), /Invalid ASAR entry size/);
  assert.throws(() => readAsarEntry('nested/entry.js', outOfFile), /Truncated ASAR entry/);
  assert.ok(sizes.every((size) => size < 1024 * 1024));
});

test('rejects invalid sizes and equivalent invalid offset representations', (t) => {
  for (const size of [-1, 1.5, '5', null, Number.MAX_SAFE_INTEGER + 1]) {
    const filename = file(t, archive({ size, offset: '0' }));
    assert.throws(() => readAsarEntry('nested/entry.js', filename), /Invalid ASAR entry size/);
  }
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '', '-1', '+1', '1.0', '1e3', '0x10', 'Infinity', null]) {
    const filename = file(t, archive({ size: 1, offset }));
    assert.throws(() => readAsarEntry('nested/entry.js', filename), /Invalid ASAR entry offset/);
  }
  const outside = file(t, archive({ size: 1, offset: '6' }));
  assert.throws(() => readAsarEntry('nested/entry.js', outside), /ASAR entry outside archive/);
});

test('rejects truncated prelude, header, entry and invalid header framing', (t) => {
  const good = archive({ size: 5, offset: '0' });
  const shortPrelude = file(t, good.subarray(0, 15));
  assert.throws(() => readAsarEntry('nested/entry.js', shortPrelude), /Truncated ASAR prelude/);
  const shortHeader = file(t, good.subarray(0, 20));
  assert.throws(() => readAsarEntry('nested/entry.js', shortHeader), /Truncated ASAR header/);
  const shortEntry = file(t, good.subarray(0, good.length - 1));
  assert.throws(() => readAsarEntry('nested/entry.js', shortEntry), /Truncated ASAR entry/);
  const badFrame = Buffer.from(good);
  badFrame.writeUInt32LE(8, 4);
  assert.throws(() => readAsarEntry('nested/entry.js', file(t, badFrame)), /Unexpected ASAR header size/);
  const hugeHeader = Buffer.from(good);
  hugeHeader.writeUInt32LE(32 * 1024 * 1024 + 1, 12);
  assert.throws(() => readAsarEntry('nested/entry.js', file(t, hugeHeader)), /Unexpected ASAR header size/);
});

test('handles partial reads and rejects a file truncated after fstat', (t) => {
  const filename = file(t, archive({ size: 5, offset: '0' }));
  const read = fs.readSync;
  const partial = t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => read(fd, buffer, offset, Math.min(length, 2), position));
  assert.equal(readAsarEntry('nested/entry.js', filename).toString(), 'hello');
  partial.mock.restore();
  t.mock.method(fs, 'readSync', () => 0);
  assert.throws(() => readAsarEntry('nested/entry.js', filename), /Truncated ASAR prelude/);
});

test('retains unavailable-entry errors for missing, directory and unpacked entries', (t) => {
  for (const entry of [{ files: {} }, { size: 5, offset: '0', unpacked: true }]) {
    const filename = file(t, archive(entry));
    assert.throws(() => readAsarEntry('nested/entry.js', filename), /ASAR entry unavailable/);
  }
  const filename = file(t, archive({ size: 5, offset: '0' }));
  assert.throws(() => readAsarEntry('missing', filename), /ASAR entry unavailable/);
});
