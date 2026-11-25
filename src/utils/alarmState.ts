export interface S200LogEntry {
  timestamp?: number;
  event?: string;
}

export interface S200CursorUpdate {
  initialized: boolean;
  lastTimestamp: number;
  event?: string;
}

export function resolveAlarmState(
  reportedState: unknown,
  lastKnownState?: boolean
): boolean | undefined {
  return typeof reportedState === 'boolean'
    ? reportedState
    : lastKnownState;
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
    return {
      initialized: true,
      lastTimestamp: latest.timestamp,
      event: latest.event
    };
  }

  return { initialized, lastTimestamp };
}
