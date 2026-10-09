import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateEsealSchema, toSealConfig } from './schema.js';

const pdf = (name = 'a.pdf', type = 'application/pdf', bytes = 4) =>
  new File([new Uint8Array(bytes)], name, { type });

test('INVISIBLE: accepts files + userId, strips positional fields', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': [pdf()],
    userId: 'u1',
    tampilan: 'INVISIBLE',
    page: '3',
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.reason, 'null');
  assert.equal('page' in result.data, false);
  assert.deepEqual(toSealConfig(result.data, 'B1/seal-image'), {
    tampilan: 'INVISIBLE',
    reason: 'null',
  });
});

test('VISIBLE: coerces numeric strings and requires coordinates', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': [pdf()],
    userId: 'u1',
    tampilan: 'VISIBLE',
    page: '1',
    originX: '0',
    originY: '10.5',
    width: '150',
    height: '50',
    location: 'Jakarta',
    imageBase64: 'aGVsbG8=',
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(toSealConfig(result.data, 'B1/seal-image'), {
    tampilan: 'VISIBLE',
    reason: 'null',
    page: 1,
    originX: 0,
    originY: 10.5,
    width: 150,
    height: 50,
    location: 'Jakarta',
    imageKey: 'B1/seal-image',
  });
});

test('VISIBLE without coordinates is rejected', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': [pdf()],
    userId: 'u1',
    tampilan: 'VISIBLE',
  });
  assert.equal(result.success, false);
});

test('VISIBLE without imageBase64, or with a data: URI, is rejected; INVISIBLE does not need it', () => {
  const visible = {
    'files[]': [pdf()],
    userId: 'u1',
    tampilan: 'VISIBLE',
    page: '1',
    originX: '0',
    originY: '0',
    width: '150',
    height: '50',
    location: 'Jakarta',
  };
  assert.equal(CreateEsealSchema.safeParse(visible).success, false);
  assert.equal(
    CreateEsealSchema.safeParse({ ...visible, imageBase64: '' }).success,
    false,
  );
  assert.equal(
    CreateEsealSchema.safeParse({
      ...visible,
      imageBase64: 'data:image/png;base64,aGVsbG8=',
    }).success,
    false,
  );
  assert.equal(
    CreateEsealSchema.safeParse({ ...visible, imageBase64: 'aGVsbG8=' }).success,
    true,
  );
  assert.equal(
    CreateEsealSchema.safeParse({
      'files[]': [pdf()],
      userId: 'u1',
      tampilan: 'INVISIBLE',
    }).success,
    true,
  );
});

test('non-PDF file is rejected', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': [pdf('a.txt', 'text/plain')],
    userId: 'u1',
    tampilan: 'INVISIBLE',
  });
  assert.equal(result.success, false);
});

test('more than ESEAL_MAX_FILES (default 20) is rejected', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': Array.from({ length: 21 }, () => pdf()),
    userId: 'u1',
    tampilan: 'INVISIBLE',
  });
  assert.equal(result.success, false);
});

test('empty files[] is rejected', () => {
  const result = CreateEsealSchema.safeParse({
    'files[]': [],
    userId: 'u1',
    tampilan: 'INVISIBLE',
  });
  assert.equal(result.success, false);
});
