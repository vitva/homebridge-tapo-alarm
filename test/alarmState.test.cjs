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

test('S200D rotation events detect clockwise and counter-clockwise direction', () => {
  const clockwise = updateS200Cursor(
    [{ timestamp: 103, event: 'Rotation', rotation_degrees: 30 }],
    true,
    102
  );
  const counterClockwise = updateS200Cursor(
    [{ timestamp: 104, click_type: 'Rotation', params_rotation_degrees: -30 }],
    true,
    103
  );

  assert.equal(clockwise.event, 'Rotation');
  assert.equal(clockwise.rotationDegrees, 30);
  assert.equal(clockwise.rotationDirection, 'right');
  assert.equal(counterClockwise.event, 'Rotation');
  assert.equal(counterClockwise.rotationDegrees, -30);
  assert.equal(counterClockwise.rotationDirection, 'left');
});

test('S200D rotation direction can be read from event labels without degrees', () => {
  const left = updateS200Cursor(
    [{ timestamp: 105, event: 'rotate_counter_clockwise' }],
    true,
    104
  );
  const right = updateS200Cursor(
    [{ timestamp: 106, event: 'rotate_right' }],
    true,
    105
  );

  assert.equal(left.rotationDirection, 'left');
  assert.equal(right.rotationDirection, 'right');
});
