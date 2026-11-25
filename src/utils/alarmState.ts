export interface S200LogEntry {
  id?: number;
  timestamp?: number;
  event?: string;
  click_type?: string;
  type?: string;
  rotation_degrees?: number;
  params_rotation_degrees?: number;
  params?: {
    rotation_degrees?: number;
    rotate_deg?: number;
  };
}

export interface S200Event {
  id: number;
  timestamp?: number;
  event?: string;
  rotationDegrees?: number;
  rotationDirection?: 'left' | 'right';
}

export interface S200CursorUpdate {
  initialized: boolean;
  lastEventId: number;
  events: S200Event[];
}

export function resolveAlarmState(
  reportedState: unknown,
  lastKnownState?: boolean
): boolean | undefined {
  return typeof reportedState === 'boolean'
    ? reportedState
    : lastKnownState;
}

export type S200EventAction =
  | 'single-click'
  | 'double-click'
  | 'rotation-right'
  | 'rotation-left';

/** Map parsed H100 trigger-log events to the HomeKit event they should emit. */
export function resolveS200EventAction(
  event: S200Event
): S200EventAction | undefined {
  if (event.rotationDirection === 'right') {
    return 'rotation-right';
  }

  if (event.rotationDirection === 'left') {
    return 'rotation-left';
  }

  const normalized = (event.event ?? '').toLowerCase().replace(/[_\s-]/g, '');
  if (normalized === 'singleclick') {
    return 'single-click';
  }

  if (normalized === 'doubleclick') {
    return 'double-click';
  }

  return undefined;
}

function getRotationDegrees(entry: S200LogEntry): number | undefined {
  const value =
    entry.rotation_degrees ??
    entry.params_rotation_degrees ??
    entry.params?.rotation_degrees ??
    entry.params?.rotate_deg;

  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getRotationDirection(
  event: string,
  degrees?: number
): 'left' | 'right' | undefined {
  if (degrees !== undefined && degrees !== 0) {
    return degrees > 0 ? 'right' : 'left';
  }

  const normalized = event.toLowerCase().replace(/[_\s-]/g, '');
  if (
    normalized.includes('counterclockwise') ||
    normalized.includes('anticlockwise') ||
    normalized.includes('rotateleft') ||
    normalized.includes('ccw') ||
    normalized.includes('left')
  ) {
    return 'left';
  }

  if (
    normalized.includes('clockwise') ||
    normalized.includes('rotateright') ||
    normalized.includes('cw') ||
    normalized.includes('right')
  ) {
    return 'right';
  }

  return undefined;
}

function getEventId(entry: S200LogEntry): number | undefined {
  if (typeof entry.id === 'number' && Number.isFinite(entry.id)) {
    return entry.id;
  }

  // Older firmware/library responses may omit the log ID. Timestamp is a
  // compatibility fallback, but event IDs are preferred when available.
  return typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
    ? entry.timestamp
    : undefined;
}

function parseEvent(entry: S200LogEntry, id: number): S200Event {
  const event = entry.event ?? entry.click_type ?? entry.type;
  const result: S200Event = {
    id,
    timestamp: entry.timestamp
  };

  if (typeof event === 'string') {
    result.event = event;
    if (/rotation|rotate/i.test(event)) {
      result.rotationDegrees = getRotationDegrees(entry);
      result.rotationDirection = getRotationDirection(
        event,
        result.rotationDegrees
      );
    }
  }

  return result;
}

/**
 * H100 returns the newest S200 trigger log entries first. The unique log ID
 * is the cursor, so events sharing a timestamp are still delivered separately.
 * Startup establishes a baseline and intentionally does not replay old events.
 */
export function updateS200Cursor(
  logs: unknown,
  initialized: boolean,
  lastEventId: number
): S200CursorUpdate {
  if (!Array.isArray(logs)) {
    return { initialized, lastEventId, events: [] };
  }

  const validLogs = (logs as S200LogEntry[])
    .map((entry) => ({ entry, id: getEventId(entry) }))
    .filter(
      (item): item is { entry: S200LogEntry; id: number } =>
        item.id !== undefined
    )
    .sort((a, b) => b.id - a.id);

  if (!initialized) {
    return {
      initialized: true,
      lastEventId: validLogs[0]?.id ?? 0,
      events: []
    };
  }

  const newLogs = validLogs
    .filter((item) => item.id > lastEventId)
    .sort((a, b) => a.id - b.id);

  if (newLogs.length === 0) {
    return { initialized: true, lastEventId, events: [] };
  }

  return {
    initialized: true,
    lastEventId: Math.max(
      lastEventId,
      ...newLogs.map((item) => item.id)
    ),
    events: newLogs.map(({ entry, id }) => parseEvent(entry, id))
  };
}
