/* Logic tests for the weather3 widget source: the twelve weather cases the
 * gen19 widget already had, plus the ZIP settings state machine. */

import { chordGesture, chordUp, createWeather3Simulator, decodeSettings, keyDown, keyUp,
  knob, rpc, tick } from "./simulator.mjs";

const RPC = Object.freeze({ begin: 0xb240, current: 0xb241, day: [0xb242, 0xb243, 0xb244],
  ack: 0xb245, status: 0xb24d, visibility: 0xb24e, commit: 0xb24f });

const packCurrent = ({ temperature, condition = 0, isDay = 1 }) =>
  ((temperature & 1023) | ((condition & 15) << 10) | ((isDay & 1) << 14)) | 0;
const packDay = ({ low, high, condition = 0, weekday = 0 }) =>
  ((low & 1023) | ((high & 1023) << 10) | ((condition & 15) << 20) | ((weekday & 7) << 24)) | 0;

/** Word -> the ASCII the packedTemperature formatter will read out of a slot. */
export function readTemperatureWord(word) {
  let text = "";
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (word >>> shift) & 0xff;
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

export function pushRevision(simulator, revision, { current, days }) {
  simulator.dispatch(rpc(RPC.begin, revision, 0));
  simulator.dispatch(rpc(RPC.current, packCurrent(current), revision));
  days.forEach((day, index) => simulator.dispatch(rpc(RPC.day[index], packDay(day), revision)));
  simulator.dispatch(rpc(RPC.commit, revision, 15));
  return simulator.slots;
}

const SAMPLE = Object.freeze({
  current: { temperature: 72, condition: 0, isDay: 1 },
  days: [
    { weekday: 3, low: 60, high: 75, condition: 0 },
    { weekday: 4, low: 58, high: 71, condition: 1 },
    { weekday: 5, low: -4, high: 12, condition: 6 },
  ],
});

/** Drives the widget into settings mode with a >= 700 ms chord hold. */
export function enterSettings(simulator) {
  return simulator.dispatchAll(chordGesture({ holdCounts: [1, 2, 3] }));
}

/** One short chord tap: advance the caret, or save on the last cell. */
export function tapChord(simulator) {
  return simulator.dispatchAll(chordGesture({}));
}

export function runTests(source) {
  const cases = [];
  const check = (name, run) => {
    try {
      const detail = run();
      cases.push({ name, ok: true, detail: detail ?? null });
    } catch (error) {
      cases.push({ name, ok: false, detail: String(error && error.message ? error.message : error) });
    }
  };
  const invariant = (ok, message) => { if (!ok) throw new Error(message); };
  const fresh = (initialSlots) => createWeather3Simulator(source, { initialSlots });

  /* ------------------------------------------------------------- weather -- */

  check("w01 coherent revision applies once and fills the weather slots", () => {
    const simulator = fresh();
    const slots = pushRevision(simulator, 1, SAMPLE);
    invariant(simulator.publicationRevision === 1, "expected exactly one publication");
    invariant(slots[0] === 1, `applied revision ${slots[0]}`);
    invariant(readTemperatureWord(slots[1]) === "72", "current temperature word");
    invariant((slots[15] & 1) === 1, "weather has-good bit");
    invariant((slots[12] & 3) === 3, "label has-good + retained bit");
    invariant((slots[13] & 1) === 0, "settings must stay inactive");
    return { slots0: slots[0] };
  });

  check("w02 incomplete revision never applies", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.begin, 1, 0));
    simulator.dispatch(rpc(RPC.current, packCurrent(SAMPLE.current), 1));
    simulator.dispatch(rpc(RPC.day[0], packDay(SAMPLE.days[0]), 1));
    simulator.dispatch(rpc(RPC.commit, 1, 15));
    invariant(simulator.publicationRevision === 0, "an incomplete revision published");
    invariant(simulator.slots[15] === 0, "flags moved on an incomplete revision");
  });

  check("w03 conflicting duplicate record invalidates the revision", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.begin, 1, 0));
    simulator.dispatch(rpc(RPC.current, packCurrent(SAMPLE.current), 1));
    simulator.dispatch(rpc(RPC.current, packCurrent({ temperature: 9 }), 1));
    SAMPLE.days.forEach((day, index) => simulator.dispatch(rpc(RPC.day[index], packDay(day), 1)));
    simulator.dispatch(rpc(RPC.commit, 1, 15));
    invariant(simulator.publicationRevision === 0, "a poisoned revision published");
  });

  check("w04 stale revision is ignored, newer one applies", () => {
    const simulator = fresh();
    pushRevision(simulator, 4, SAMPLE);
    pushRevision(simulator, 2, SAMPLE);
    invariant(simulator.slots[0] === 4, `revision regressed to ${simulator.slots[0]}`);
    pushRevision(simulator, 5, { ...SAMPLE, current: { temperature: 81, condition: 2, isDay: 1 } });
    invariant(simulator.slots[0] === 5, "newer revision did not apply");
    invariant(readTemperatureWord(simulator.slots[1]) === "81", "temperature did not move");
  });

  check("w05 invalid day record (low > high) is rejected", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.begin, 1, 0));
    simulator.dispatch(rpc(RPC.current, packCurrent(SAMPLE.current), 1));
    simulator.dispatch(rpc(RPC.day[0], packDay({ weekday: 1, low: 40, high: 10 }), 1));
    simulator.dispatch(rpc(RPC.day[1], packDay(SAMPLE.days[1]), 1));
    simulator.dispatch(rpc(RPC.day[2], packDay(SAMPLE.days[2]), 1));
    simulator.dispatch(rpc(RPC.commit, 1, 15));
    invariant(simulator.publicationRevision === 0, "an inverted day record applied");
  });

  check("w06 tick.1s republishes without disturbing the forecast slots", () => {
    const simulator = fresh();
    const before = pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(tick());
    const after = simulator.slots;
    invariant(simulator.publicationRevision === 2, "tick did not publish");
    invariant(before.slice(0, 12).join() === after.slice(0, 12).join(), "tick moved a weather slot");
  });

  check("w07 provider error sets the error bit and clamps the retry counter", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.status, 1, 30));
    invariant((simulator.slots[15] & 4) === 4, "provider error bit");
    invariant(decodeSettings(simulator.slots).timer === 30, "retry counter");
    simulator.dispatch(rpc(RPC.status, 1, 86400));
    invariant(decodeSettings(simulator.slots).timer === 31, "retry counter clamp");
  });

  check("w08 hidden widget sets bit 1 and stops ticking", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.visibility, 0, 0));
    invariant((simulator.slots[15] & 2) === 2, "hidden bit");
    const publications = simulator.publicationRevision;
    simulator.dispatch(tick());
    invariant(simulator.publicationRevision === publications, "a hidden tick published");
  });

  check("w09 re-shown widget clears the hidden bit", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.visibility, 0, 0));
    simulator.dispatch(rpc(RPC.visibility, 1, 120));
    invariant((simulator.slots[15] & 2) === 0, "hidden bit stuck");
    invariant((simulator.slots[15] & 1) === 1, "weather has-good lost");
  });

  check("w10 negative temperatures keep their sign byte", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, { current: { temperature: -8, condition: 7, isDay: 0 },
      days: [{ weekday: 0, low: -120, high: -99, condition: 6 },
        { weekday: 1, low: 99, high: 104, condition: 4 },
        { weekday: 2, low: 0, high: 100, condition: 2 }] });
    invariant(readTemperatureWord(simulator.slots[1]) === "-8", "current sign");
    invariant(readTemperatureWord(simulator.slots[4]) === "-120", "day 1 low sign");
    invariant(readTemperatureWord(simulator.slots[5]) === "-99", "day 1 high sign");
  });

  check("w11 night clear maps to the dedicated card label entry", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, { ...SAMPLE, current: { temperature: 55, condition: 0, isDay: 0 } });
    invariant(decodeSettings(simulator.slots).labelIndex === 8, "night clear label index");
    pushRevision(simulator, 2, { ...SAMPLE, current: { temperature: 55, condition: 5, isDay: 0 } });
    invariant(decodeSettings(simulator.slots).labelIndex === 5, "night rain reuses the day word");
    pushRevision(simulator, 3, { ...SAMPLE, current: { temperature: 55, condition: 2, isDay: 1 } });
    invariant(decodeSettings(simulator.slots).labelIndex === 2, "day cloudy label index");
  });

  check("w12 knob and keys still prove the input gate outside settings", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(knob(-3));
    invariant(decodeSettings(simulator.slots).timer === 20, "knob did not set the canary counter");
    invariant((simulator.slots[15] & 4) === 4, "knob did not set the canary error bit");
    simulator.dispatch(rpc(RPC.status, 0, 0));
    simulator.dispatch(keyDown(0, 1));
    invariant(decodeSettings(simulator.slots).timer === 20, "key down did not set the counter");
    simulator.dispatch(keyUp(0, 0));
    invariant(simulator.slots[0] === 1, "input disturbed the applied revision");
  });

  /* ------------------------------------------------------------ settings -- */

  check("s01 chord held ~700 ms opens the settings view", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    enterSettings(simulator);
    const state = decodeSettings(simulator.slots);
    invariant(state.settingsActive, "settings did not open");
    invariant(state.labelIndex === 9, `card label index ${state.labelIndex}, expected ZIP (9)`);
    invariant(state.digits.join("") === "60601", `digits ${state.digits.join("")}`);
    invariant(state.caret === 0, "caret did not start on the first cell");
    invariant(!state.weatherGood, "weather targets are still enabled");
    invariant(state.settingsGood && state.labelGood, "settings targets are not enabled");
    invariant(state.timer === 30, "idle timer did not arm");
    return state;
  });

  check("s02 a shorter chord hold does not open the settings view", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatchAll(chordGesture({ holdCounts: [1, 2] }));
    invariant(!decodeSettings(simulator.slots).settingsActive, "a 600 ms hold opened settings");
  });

  check("s03 knob edits the active cell and wraps 0..9", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    enterSettings(simulator);
    simulator.dispatch(knob(1));
    invariant(decodeSettings(simulator.slots).digits.join("") === "70601", "knob +1");
    simulator.dispatch(knob(3));
    invariant(decodeSettings(simulator.slots).digits.join("") === "00601", "knob wrap past 9");
    simulator.dispatch(knob(-1));
    invariant(decodeSettings(simulator.slots).digits.join("") === "90601", "knob wrap below 0");
    invariant(decodeSettings(simulator.slots).timer === 30, "knob did not rearm the idle timer");
  });

  check("s04 chord tap advances the caret across the five cells", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 12345, 0));
    enterSettings(simulator);
    for (let index = 1; index <= 4; index++) {
      tapChord(simulator);
      invariant(decodeSettings(simulator.slots).caret === index,
        `caret ${decodeSettings(simulator.slots).caret}, expected ${index}`);
    }
    simulator.dispatch(knob(4));
    invariant(decodeSettings(simulator.slots).digits.join("") === "12349", "last cell edit");
  });

  check("s05 advancing off the last cell saves", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    enterSettings(simulator);
    for (let index = 0; index < 4; index++) tapChord(simulator);
    simulator.dispatch(knob(1));
    const before = decodeSettings(simulator.slots);
    tapChord(simulator);
    const state = decodeSettings(simulator.slots);
    invariant(state.pendingSave, "pendingSave was not raised");
    invariant(state.saveSeq === ((before.saveSeq + 1) & 0xff), "saveSeq did not increment");
    invariant(state.zip === 60602, `saved zip ${state.zip}`);
    invariant(state.labelIndex === 10, "card label is not Saving");
    invariant(state.settingsActive, "settings closed on save");
    return { word: simulator.slots[14] >>> 0, saveSeq: state.saveSeq };
  });

  check("s06 the host ack clears pendingSave, shows Saved and returns to weather", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    pushRevision(simulator, 1, SAMPLE);
    enterSettings(simulator);
    for (let index = 0; index < 4; index++) tapChord(simulator);
    simulator.dispatch(knob(1));
    tapChord(simulator);
    const saved = decodeSettings(simulator.slots);
    simulator.dispatch(rpc(RPC.ack, saved.zip, saved.saveSeq));
    const acked = decodeSettings(simulator.slots);
    invariant(!acked.pendingSave, "pendingSave survived the ack");
    invariant(acked.zip === 60602, "acked zip");
    invariant(acked.labelIndex === 11, "card label is not Saved");
    invariant(acked.settingsActive, "the Saved frame closed too early");
    simulator.dispatch(tick());
    simulator.dispatch(tick());
    const done = decodeSettings(simulator.slots);
    invariant(!done.settingsActive, "the Saved frame never returned to weather");
    invariant(done.weatherGood, "the weather view did not come back");
    invariant(readTemperatureWord(simulator.slots[1]) === "72", "the forecast was not restored");
  });

  check("s07 a stale ack is ignored while a save is pending", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    enterSettings(simulator);
    for (let index = 0; index < 4; index++) tapChord(simulator);
    tapChord(simulator);
    const saved = decodeSettings(simulator.slots);
    simulator.dispatch(rpc(RPC.ack, 11111, (saved.saveSeq + 9) & 0xff));
    const state = decodeSettings(simulator.slots);
    invariant(state.pendingSave, "a stale ack cleared pendingSave");
    invariant(state.zip === saved.zip, "a stale ack moved the zip");
  });

  check("s08 30 s of inactivity cancels back to the weather view", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    pushRevision(simulator, 1, SAMPLE);
    enterSettings(simulator);
    simulator.dispatch(knob(1));
    invariant(decodeSettings(simulator.slots).digits.join("") === "70601", "edit did not land");
    for (let second = 0; second < 29; second++) simulator.dispatch(tick());
    invariant(decodeSettings(simulator.slots).settingsActive, "cancelled before 30 s");
    simulator.dispatch(tick());
    const state = decodeSettings(simulator.slots);
    invariant(!state.settingsActive, "the idle timeout did not cancel");
    invariant(state.zip === 60601, `the abandoned edit stuck: ${state.zip}`);
    invariant(state.weatherGood && readTemperatureWord(simulator.slots[1]) === "72",
      "weather did not come back after the timeout");
  });

  check("s09 a second long chord hold cancels the settings view", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    pushRevision(simulator, 1, SAMPLE);
    enterSettings(simulator);
    simulator.dispatch(knob(2));
    simulator.dispatchAll(chordGesture({ holdCounts: [1, 2, 3] }));
    const state = decodeSettings(simulator.slots);
    invariant(!state.settingsActive, "the exit hold did not close settings");
    invariant(state.zip === 60601, "the exit hold kept the abandoned edit");
    invariant(state.weatherGood, "weather did not come back");
  });

  check("s10 key and chord edges do not fire the canary poke inside settings", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.status, 0, 0));
    enterSettings(simulator);
    const before = decodeSettings(simulator.slots);
    simulator.dispatch(keyDown(0, 1));
    simulator.dispatch(keyUp(0, 0));
    const after = decodeSettings(simulator.slots);
    invariant(after.timer === before.timer, "a key edge moved the settings idle timer");
    invariant(after.settingsActive, "a key edge closed the settings view");
  });

  check("s11 the boot ack sets the zip without opening settings", () => {
    const simulator = fresh();
    pushRevision(simulator, 1, SAMPLE);
    simulator.dispatch(rpc(RPC.ack, 94107, 0));
    const state = decodeSettings(simulator.slots);
    invariant(!state.settingsActive, "the boot ack opened settings");
    invariant(state.zip === 94107, "the boot ack did not store the zip");
    invariant(state.weatherGood, "the boot ack disturbed the weather view");
    enterSettings(simulator);
    invariant(decodeSettings(simulator.slots).digits.join("") === "94107", "digits after the ack");
  });

  check("s12 an out-of-range ack is refused", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    simulator.dispatch(rpc(RPC.ack, 100000, 0));
    simulator.dispatch(rpc(RPC.ack, -5, 0));
    invariant(decodeSettings(simulator.slots).zip === 60601, "an invalid ack moved the zip");
  });

  check("s13 a weather revision that lands during settings is held back", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    pushRevision(simulator, 1, SAMPLE);
    enterSettings(simulator);
    const digits = decodeSettings(simulator.slots).digits.join("");
    pushRevision(simulator, 2, { ...SAMPLE, current: { temperature: 81, condition: 3, isDay: 1 } });
    const state = decodeSettings(simulator.slots);
    invariant(state.settingsActive, "a revision closed the settings view");
    invariant(state.digits.join("") === digits, "a revision overwrote the ZIP cells");
    invariant(!state.weatherGood, "a revision re-enabled the weather targets");
    simulator.dispatchAll(chordGesture({ holdCounts: [1, 2, 3] }));
    invariant(readTemperatureWord(simulator.slots[1]) === "81",
      "the held-back revision was not applied on exit");
  });

  check("s14 settings state survives a context reset via the mailbox", () => {
    const simulator = fresh();
    simulator.dispatch(rpc(RPC.ack, 60601, 0));
    pushRevision(simulator, 1, SAMPLE);
    enterSettings(simulator);
    tapChord(simulator);
    simulator.dispatch(knob(5));
    const before = decodeSettings(simulator.slots);
    const restarted = fresh([...simulator.slots]);
    restarted.dispatch(knob(1));
    const after = decodeSettings(restarted.slots);
    invariant(after.settingsActive, "settings did not survive the reset");
    invariant(after.caret === before.caret, "the caret did not survive the reset");
    invariant(after.digits[1] === (before.digits[1] + 1) % 10, "the reset lost the edited digit");
    invariant(after.zip === before.zip + 1000, "the reset lost the zip");
  });

  const failed = cases.filter(({ ok }) => !ok);
  return { total: cases.length, passed: cases.length - failed.length, failed: failed.length, cases };
}
