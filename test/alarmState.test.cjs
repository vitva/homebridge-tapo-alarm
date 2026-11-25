/* eslint-env node */
const assert = require('node:assert/strict');
const { test } = require('node:test');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS' }
});

const {
  resolveAlarmState,
  updateS200Cursor
} = require('../src/utils/alarmState.ts');

test('alarm telemetry updates the state when it is boolean', () => {
  assert.equal(resolveAlarmState(true, false), true);
  assert.equal(resolveAlarmState(false, true), false);
});

test('missing alarm telemetry preserves the last known state', () => {
  assert.equal(resolveAlarmState(undefined, true), true);
  assert.equal(resolveAlarmState(null, false), false);
  assert.equal(resolveAlarmState(undefined), undefined);
});

test('S200 startup establishes a baseline without replaying an old event', () => {
  const update = updateS200Cursor(
    [{ timestamp: 100, event: 'singleClick' }],
    false,
    0
  );

  assert.deepEqual(update, { initialized: true, lastTimestamp: 100 });
});

test('S200 first successful poll after startup failure establishes a baseline', () => {
  const update = updateS200Cursor(
    [{ timestamp: 200, event: 'doubleClick' }],
    false,
    0
  );

  assert.deepEqual(update, { initialized: true, lastTimestamp: 200 });
});

test('S200 cursor preserves state when logs are unavailable', () => {
  assert.deepEqual(updateS200Cursor(undefined, true, 100), {
    initialized: true,
    lastTimestamp: 100
  });
});

test('S200 cursor detects a new single or double click once', () => {
  const single = updateS200Cursor(
    [{ timestamp: 101, event: 'singleClick' }],
    true,
    100
  );
  const double = updateS200Cursor(
    [{ timestamp: 102, event: 'doubleClick' }],
    true,
    101
  );

  assert.deepEqual(single, {
    initialized: true,
    lastTimestamp: 101,
    event: 'singleClick'
  });
  assert.deepEqual(double, {
    initialized: true,
    lastTimestamp: 102,
    event: 'doubleClick'
  });
});

test('S200 cursor ignores repeated, older, and invalid timestamps', () => {
  assert.deepEqual(
    updateS200Cursor([{ timestamp: 100, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100 }
  );
  assert.deepEqual(
    updateS200Cursor([{ timestamp: 99, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100 }
  );
  assert.deepEqual(
    updateS200Cursor([{ timestamp: Number.NaN, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100 }
  );
});
