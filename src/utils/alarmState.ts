export interface S200LogEntry {
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
  timestamp: number;
  event?: string;
  rotationDegrees?: number;
  rotationDirection?: 'left' | 'right';
}

export interface S200CursorUpdate {
  initialized: boolean;
  lastTimestamp: number;
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

  const normalized = event.toLowerCase().replace(/[_\\s-]/g, '');
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

function parseEvent(entry: S200LogEntry): S200Event {
  const event = entry.event ?? entry.click_type ?? entry.type;
  const result: S200Event = {
    timestamp: entry.timestamp as number
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
 * H100 returns the newest S200 log entries first. Process every entry newer
 * than the cursor, in chronological order, instead of dropping all but logs[0].
 * The startup call intentionally establishes a baseline and never replays
 * events that were already present before Homebridge began polling.
 */
export function updateS200Cursor(
  logs: unknown,
  initialized: boolean,
  lastTimestamp: number
): S200CursorUpdate {
  if (!Array.isArray(logs)) {
    return { initialized, lastTimestamp, events: [] };
  }

  const validLogs = (logs as S200LogEntry[])
    .filter(
      (entry) =>
        typeof entry?.timestamp === 'number' &&
        Number.isFinite(entry.timestamp)
    )
    .sort((a, b) => (b.timestamp as number) - (a.timestamp as number));

  if (!initialized) {
    return {
      initialized: true,
      lastTimestamp: validLogs[0]?.timestamp ?? 0,
      events: []
    };
  }

  const newLogs = validLogs
    .filter((entry) => (entry.timestamp as number) > lastTimestamp)
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  if (newLogs.length === 0) {
    return { initialized: true, lastTimestamp, events: [] };
  }

  return {
    initialized: true,
    lastTimestamp: Math.max(
      lastTimestamp,
      ...newLogs.map((entry) => entry.timestamp as number)
    ),
    events: newLogs.map(parseEvent)
  };
}
