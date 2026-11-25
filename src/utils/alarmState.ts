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

export interface S200CursorUpdate {
  initialized: boolean;
  lastTimestamp: number;
  event?: string;
  rotationDegrees?: number;
  rotationDirection?: 'left' | 'right';
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

export function updateS200Cursor(
  logs: unknown,
  initialized: boolean,
  lastTimestamp: number
): S200CursorUpdate {
  if (!Array.isArray(logs)) {
    return { initialized, lastTimestamp };
  }

  const latest = logs[0] as S200LogEntry | undefined;

  if (!initialized) {
    return {
      initialized: true,
      lastTimestamp:
        typeof latest?.timestamp === 'number' &&
        Number.isFinite(latest.timestamp)
          ? latest.timestamp
          : 0
    };
  }

  if (
    typeof latest?.timestamp === 'number' &&
    Number.isFinite(latest.timestamp) &&
    lastTimestamp < latest.timestamp
  ) {
    const event = latest.event ?? latest.click_type ?? latest.type;
    const result: S200CursorUpdate = {
      initialized: true,
      lastTimestamp: latest.timestamp
    };

    if (typeof event === 'string') {
      result.event = event;
      if (/rotation|rotate/i.test(event)) {
        result.rotationDegrees = getRotationDegrees(latest);
        result.rotationDirection = getRotationDirection(
          event,
          result.rotationDegrees
        );
      }
    }

    return result;
  }

  return { initialized, lastTimestamp };
}
