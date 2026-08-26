// Event-log identity + session partitioning.
//
// The store's rolling log is a protected surface, so the shell can neither
// reset it nor tag its entries. Two panel-side mechanisms stand in:
//
//   * logEntryId — a WeakMap identity per entry object (the store appends, so
//     references are stable). Ids ascend with dispatch order; every log view
//     keys rows, freshness baselines, and clear watermarks off them.
//   * session markers — recorded by the shell the moment a preset load
//     replaces the widget source. Every log view renders a labeled divider at
//     the marker ("Loaded Weather · 07:03.412"), so rows that belong to a
//     previous widget can never be read as the current one's output.

export interface EventLogEntry {
  label: string;
  at: Date;
}

const LOG_IDS = new WeakMap<object, number>();
let nextLogId = 0;

export function logEntryId(entry: object): number {
  let id = LOG_IDS.get(entry);
  if (id === undefined) {
    id = nextLogId++;
    LOG_IDS.set(entry, id);
  }
  return id;
}

export function peekNextLogId(): number {
  return nextLogId;
}

export interface LogSessionMarker {
  /** Entries with id < floor belong to the PREVIOUS widget. */
  floor: number;
  /** Display name of the widget that was loaded at this boundary. */
  label: string;
  at: Date;
}

const sessions: LogSessionMarker[] = [];
const MAX_SESSIONS = 16;

/**
 * Record a session boundary: everything logged so far belongs to the outgoing
 * widget. Call in the same action that replaces the source (preset load).
 * Consecutive loads with no events in between collapse into one marker — the
 * divider names the widget that actually ran, never a stack of no-op loads.
 */
export function markLogSession(log: readonly EventLogEntry[], label: string) {
  log.forEach(logEntryId);
  const floor = peekNextLogId();
  const last = sessions[sessions.length - 1];
  if (last && last.floor === floor) {
    last.label = label;
    last.at = new Date();
    return;
  }
  sessions.push({ floor, label, at: new Date() });
  if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
}

/** Oldest → newest (floors ascend). */
export function getLogSessions(): readonly LogSessionMarker[] {
  return sessions;
}
