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

test('S200 startup establishes an ID baseline without replaying old events', () => {
  const update = updateS200Cursor(
    [
      { id: 100, timestamp: 1000, click_type: 'single_click' },
      { id: 90, timestamp: 900, click_type: 'double_click' }
    ],
    false,
    0
  );

  assert.deepEqual(update, {
    initialized: true,
    lastEventId: 100,
    events: []
  });
});

test('S200 first successful poll after startup failure establishes a baseline', () => {
  const update = updateS200Cursor(
    [{ id: 200, timestamp: 2000, click_type: 'double_click' }],
    false,
    0
  );

  assert.deepEqual(update, {
    initialized: true,
    lastEventId: 200,
    events: []
  });
});

test('S200 cursor preserves state when logs are unavailable', () => {
  assert.deepEqual(updateS200Cursor(undefined, true, 100), {
    initialized: true,
    lastEventId: 100,
    events: []
  });
});

test('S200 cursor detects a new single or double click once', () => {
  const single = updateS200Cursor(
    [{ id: 101, timestamp: 1001, click_type: 'single_click' }],
    true,
    100
  );
  const double = updateS200Cursor(
    [{ id: 102, timestamp: 1002, click_type: 'double_click' }],
    true,
    101
  );

  assert.deepEqual(single, {
    initialized: true,
    lastEventId: 101,
    events: [{ id: 101, timestamp: 1001, event: 'single_click' }]
  });
  assert.deepEqual(double, {
    initialized: true,
    lastEventId: 102,
    events: [{ id: 102, timestamp: 1002, event: 'double_click' }]
  });
});

test('S200 cursor ignores repeated, older, and invalid IDs', () => {
  assert.deepEqual(
    updateS200Cursor([{ id: 100, click_type: 'single_click' }], true, 100),
    { initialized: true, lastEventId: 100, events: [] }
  );
  assert.deepEqual(
    updateS200Cursor([{ id: 99, click_type: 'single_click' }], true, 100),
    { initialized: true, lastEventId: 100, events: [] }
  );
  assert.deepEqual(
    updateS200Cursor([{ id: Number.NaN, click_type: 'single_click' }], true, 100),
    { initialized: true, lastEventId: 100, events: [] }
  );
});

test('S200D rotation events detect clockwise and counter-clockwise direction', () => {
  const clockwise = updateS200Cursor(
    [{ id: 103, timestamp: 1003, click_type: 'Rotation', rotation_degrees: 30 }],
    true,
    102
  );
  const counterClockwise = updateS200Cursor(
    [{ id: 104, timestamp: 1004, click_type: 'Rotation', params_rotation_degrees: -30 }],
    true,
    103
  );

  assert.deepEqual(clockwise.events[0], {
    id: 103,
    timestamp: 1003,
    event: 'Rotation',
    rotationDegrees: 30,
    rotationDirection: 'right'
  });
  assert.deepEqual(counterClockwise.events[0], {
    id: 104,
    timestamp: 1004,
    event: 'Rotation',
    rotationDegrees: -30,
    rotationDirection: 'left'
  });
});

test('S200D rotation direction can be read from event labels without degrees', () => {
  const left = updateS200Cursor(
    [{ id: 105, click_type: 'rotate_counter_clockwise' }],
    true,
    104
  );
  const right = updateS200Cursor(
    [{ id: 106, click_type: 'rotate_right' }],
    true,
    105
  );

  assert.equal(left.events[0].rotationDirection, 'left');
  assert.equal(right.events[0].rotationDirection, 'right');
});

test('S200 cursor returns every unseen event in chronological ID order', () => {
  const update = updateS200Cursor(
    [
      { id: 104, timestamp: 1004, click_type: 'Rotation', rotation_degrees: -15 },
      { id: 103, timestamp: 1003, click_type: 'double_click' },
      { id: 102, timestamp: 1002, click_type: 'Rotation', rotation_degrees: 15 },
      { id: 101, timestamp: 1001, click_type: 'single_click' },
      { id: 100, timestamp: 1000, click_type: 'single_click' }
    ],
    true,
    100
  );

  assert.equal(update.lastEventId, 104);
  assert.deepEqual(
    update.events.map(({ id, event, rotationDirection }) => ({
      id,
      event,
      rotationDirection
    })),
    [
      { id: 101, event: 'single_click', rotationDirection: undefined },
      { id: 102, event: 'Rotation', rotationDirection: 'right' },
      { id: 103, event: 'double_click', rotationDirection: undefined },
      { id: 104, event: 'Rotation', rotationDirection: 'left' }
    ]
  );
});

test('S200 cursor retains separate events that share a timestamp', () => {
  const update = updateS200Cursor(
    [
      { id: 102, timestamp: 1000, click_type: 'double_click' },
      { id: 101, timestamp: 1000, click_type: 'single_click' },
      { id: 100, timestamp: 999, click_type: 'single_click' }
    ],
    true,
    99
  );

  assert.deepEqual(
    update.events.map(({ id, timestamp, event }) => ({ id, timestamp, event })),
    [
      { id: 100, timestamp: 999, event: 'single_click' },
      { id: 101, timestamp: 1000, event: 'single_click' },
      { id: 102, timestamp: 1000, event: 'double_click' }
    ]
  );
});

test('S200 cursor supports older responses without IDs using timestamps', () => {
  const update = updateS200Cursor(
    [{ timestamp: 501, event: 'singleClick' }],
    true,
    500
  );

  assert.deepEqual(update, {
    initialized: true,
    lastEventId: 501,
    events: [{ id: 501, timestamp: 501, event: 'singleClick' }]
  });
});
