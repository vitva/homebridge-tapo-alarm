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

test('S200 startup establishes a baseline without replaying old events', () => {
  const update = updateS200Cursor(
    [
      { timestamp: 100, event: 'singleClick' },
      { timestamp: 90, event: 'doubleClick' }
    ],
    false,
    0
  );

  assert.deepEqual(update, {
    initialized: true,
    lastTimestamp: 100,
    events: []
  });
});

test('S200 first successful poll after startup failure establishes a baseline', () => {
  const update = updateS200Cursor(
    [{ timestamp: 200, event: 'doubleClick' }],
    false,
    0
  );

  assert.deepEqual(update, {
    initialized: true,
    lastTimestamp: 200,
    events: []
  });
});

test('S200 cursor preserves state when logs are unavailable', () => {
  assert.deepEqual(updateS200Cursor(undefined, true, 100), {
    initialized: true,
    lastTimestamp: 100,
    events: []
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
    events: [{ timestamp: 101, event: 'singleClick' }]
  });
  assert.deepEqual(double, {
    initialized: true,
    lastTimestamp: 102,
    events: [{ timestamp: 102, event: 'doubleClick' }]
  });
});

test('S200 cursor ignores repeated, older, and invalid timestamps', () => {
  assert.deepEqual(
    updateS200Cursor([{ timestamp: 100, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100, events: [] }
  );
  assert.deepEqual(
    updateS200Cursor([{ timestamp: 99, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100, events: [] }
  );
  assert.deepEqual(
    updateS200Cursor([{ timestamp: Number.NaN, event: 'singleClick' }], true, 100),
    { initialized: true, lastTimestamp: 100, events: [] }
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

  assert.deepEqual(clockwise.events[0], {
    timestamp: 103,
    event: 'Rotation',
    rotationDegrees: 30,
    rotationDirection: 'right'
  });
  assert.deepEqual(counterClockwise.events[0], {
    timestamp: 104,
    event: 'Rotation',
    rotationDegrees: -30,
    rotationDirection: 'left'
  });
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

  assert.equal(left.events[0].rotationDirection, 'left');
  assert.equal(right.events[0].rotationDirection, 'right');
});

test('S200 cursor returns every unseen event in chronological order', () => {
  const update = updateS200Cursor(
    [
      { timestamp: 104, event: 'Rotation', rotation_degrees: -15 },
      { timestamp: 103, event: 'doubleClick' },
      { timestamp: 102, event: 'Rotation', rotation_degrees: 15 },
      { timestamp: 101, event: 'singleClick' },
      { timestamp: 100, event: 'singleClick' }
    ],
    true,
    100
  );

  assert.equal(update.lastTimestamp, 104);
  assert.deepEqual(
    update.events.map(({ timestamp, event, rotationDirection }) => ({
      timestamp,
      event,
      rotationDirection
    })),
    [
      { timestamp: 101, event: 'singleClick', rotationDirection: undefined },
      { timestamp: 102, event: 'Rotation', rotationDirection: 'right' },
      { timestamp: 103, event: 'doubleClick', rotationDirection: undefined },
      { timestamp: 104, event: 'Rotation', rotationDirection: 'left' }
    ]
  );
});

test('S200 cursor retains multiple events that share a timestamp', () => {
  const update = updateS200Cursor(
    [
      { timestamp: 102, event: 'doubleClick' },
      { timestamp: 102, event: 'singleClick' },
      { timestamp: 101, event: 'singleClick' }
    ],
    true,
    100
  );

  assert.deepEqual(
    update.events.map(({ timestamp, event }) => ({ timestamp, event })),
    [
      { timestamp: 101, event: 'singleClick' },
      { timestamp: 102, event: 'doubleClick' },
      { timestamp: 102, event: 'singleClick' }
    ]
  );
});
