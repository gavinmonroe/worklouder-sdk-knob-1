// The ONE clock for event timestamps — the rail's Event log and the Events
// tab's Recorded log print the same dispatch, so they must print the same
// instant the same way (a "07:03.485" beside a 12h "2:07:03 PM" reads as two
// different events).
//
// mm:ss.mmm, deliberately hourless: the rolling log spans minutes of
// interaction, never enough for the hour to disambiguate anything — and in
// the 340px rail those two glyphs plus a colon are ~30px the event label
// needs far more. Milliseconds matter: at 100ms auto-tick, whole-second
// timestamps print up to ten identical rows — .SSS is the only readable
// resolution here.

const EVENT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

export function formatEventTime(at: Date): string {
  return EVENT_TIME_FORMAT.format(at);
}
