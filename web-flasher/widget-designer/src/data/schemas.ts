// ─────────────────────────────────────────────────────────────────────────────
// Host-data schemas: one definition, used by both sides.
//
// Nobody writes a bit offset. A record lists its fields in order with widths,
// and offsets are DERIVED by packing them sequentially from bit 0 — which is
// exactly how f1-widget-sdk/src/render-v2/weather.mjs lays its payloads out.
// `test/schemas.test.ts` pins that equivalence against the SDK's own packed
// values, so if the two ever diverge the tests fail rather than the device
// rendering nonsense.
//
// The same schema drives:
//   * the encoder below, which produces the sample/host events
//   * widget.snapshot(name, ...) in the runtime, which decodes them
//
// so a layout change lands on both sides at once and cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldSpec {
  /** Width in bits. */
  bits: number;
  /** Two's-complement rather than unsigned. */
  signed?: boolean;
  /** Optional labels, so a widget renders names instead of magic numbers. */
  labels?: readonly string[];
}

export interface RecordSpec {
  /** host.rpc id carrying this record. */
  id: number;
  /** Declaration order IS the bit order. */
  fields: Record<string, FieldSpec>;
}

/**
 * An optional live data source. Any schema can declare one, and the Designer
 * offers a single "fetch" button for it — nothing about that button is
 * weather-specific, so a new schema gets real data for free.
 */
export interface SnapshotSource {
  /** Shown on the button, e.g. "Open-Meteo". */
  label: string;
  /** Free-text input hint, e.g. a postal code or city. */
  inputLabel: string;
  defaultInput: string;
  /** Resolve live values keyed by record name, ready for encodeSnapshot(). */
  fetch: (input: string) => Promise<{
    values: Record<string, Record<string, number>>;
    /** Optional caption describing what was fetched, e.g. the resolved place. */
    note?: string;
  }>;
}

export interface SnapshotSchema {
  /** Announces a revision; staging starts fresh. */
  begin: number;
  /** Publishes the staged records, but only if the revision matches. */
  commit: number;
  records: Record<string, RecordSpec>;
  /** Zero or more live sources the Designer can offer. */
  sources?: SnapshotSource[];
}

/** Field offsets, derived from declaration order. Never hand-written. */
export function fieldOffsets(record: RecordSpec): Record<string, number> {
  const offsets: Record<string, number> = {};
  let cursor = 0;
  for (const [name, spec] of Object.entries(record.fields)) {
    offsets[name] = cursor;
    cursor += spec.bits;
  }
  if (cursor > 32) {
    throw new RangeError(`Record 0x${record.id.toString(16)} needs ${cursor} bits; the payload is 32.`);
  }
  return offsets;
}

/** Pack named values into the record's single int32 payload. */
export function packRecord(record: RecordSpec, values: Record<string, number>): number {
  const offsets = fieldOffsets(record);
  let packed = 0;
  for (const [name, spec] of Object.entries(record.fields)) {
    const value = values[name];
    if (value === undefined) throw new RangeError(`Missing field "${name}".`);
    const mask = spec.bits >= 32 ? 0xffffffff : (1 << spec.bits) - 1;
    if (spec.signed) {
      const limit = 1 << (spec.bits - 1);
      if (value < -limit || value >= limit) {
        throw new RangeError(`"${name}" = ${value} does not fit ${spec.bits} signed bits.`);
      }
    } else if (value < 0 || value > mask) {
      throw new RangeError(`"${name}" = ${value} does not fit ${spec.bits} unsigned bits.`);
    }
    packed |= (value & mask) << offsets[name];
  }
  return packed | 0;
}

/** Decode a payload back to named values — the mirror of packRecord. */
export function unpackRecord(record: RecordSpec, packed: number): Record<string, number> {
  const offsets = fieldOffsets(record);
  const out: Record<string, number> = {};
  for (const [name, spec] of Object.entries(record.fields)) {
    const mask = spec.bits >= 32 ? 0xffffffff : (1 << spec.bits) - 1;
    let raw = (packed >>> offsets[name]) & mask;
    if (spec.signed && raw >= 1 << (spec.bits - 1)) raw -= 1 << spec.bits;
    out[name] = raw;
  }
  return out;
}

/**
 * Build the full host.rpc event sequence for a snapshot: begin, one event per
 * record in declaration order, then commit.
 */
export function encodeSnapshot(
  schema: SnapshotSchema,
  revision: number,
  values: Record<string, Record<string, number>>,
): { id: number; value: number }[] {
  const events = [{ id: schema.begin, value: revision }];
  for (const [name, record] of Object.entries(schema.records)) {
    const record_values = values[name];
    if (!record_values) throw new RangeError(`Missing record "${name}".`);
    events.push({ id: record.id, value: packRecord(record, record_values) });
  }
  events.push({ id: schema.commit, value: revision });
  return events;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CONDITIONS = ["Sunny", "Partly", "Cloudy", "Fog", "Drizzle", "Rain", "Snow", "Storm"] as const;

const DAY_FIELDS: Record<string, FieldSpec> = {
  low: { bits: 10, signed: true },
  high: { bits: 10, signed: true },
  condition: { bits: 4, labels: CONDITIONS },
  weekday: { bits: 3, labels: WEEKDAYS },
};

/** Matches WEATHER_WIDGET_HOST_EVENTS in f1-widget-sdk/src/render-v2/weather.mjs. */
export const WEATHER_SCHEMA: SnapshotSchema = {
  begin: 0xb240,
  commit: 0xb24f,
  records: {
    current: {
      id: 0xb241,
      fields: {
        temperature: { bits: 10, signed: true },
        condition: { bits: 4, labels: CONDITIONS },
        isDay: { bits: 1 },
      },
    },
    day1: { id: 0xb242, fields: DAY_FIELDS },
    day2: { id: 0xb243, fields: DAY_FIELDS },
    day3: { id: 0xb244, fields: DAY_FIELDS },
  },
};

/**
 * Blank starting point for a widget that wants host data. There is deliberately
 * no global registry: a schema belongs to the widget that declares it, which is
 * what lets any custom widget have its own server.
 */
export function createEmptySchema(): SnapshotSchema {
  return {
    begin: 0xb300,
    commit: 0xb30f,
    records: { reading: { id: 0xb301, fields: { value: { bits: 16, signed: true } } } },
  };
}

/**
 * The exact JSON a server must return for a schema. Derived, so it always
 * matches the fields the widget actually declares.
 */
export function serverContract(schema: SnapshotSchema): string {
  const values: Record<string, Record<string, number>> = {};
  for (const [name, record] of Object.entries(schema.records)) {
    values[name] = {};
    for (const [field, spec] of Object.entries(record.fields)) {
      const limit = spec.signed ? (1 << (spec.bits - 1)) - 1 : (1 << spec.bits) - 1;
      values[name][field] = Math.min(1, limit);
    }
  }
  return JSON.stringify({ values, note: "optional caption" }, null, 2);
}

/** Field table with derived offsets and ranges, so limits explain themselves. */
export function describeSchema(schema: SnapshotSchema): string[] {
  const lines: string[] = [
    `begin 0x${schema.begin.toString(16).toUpperCase()}   commit 0x${schema.commit.toString(16).toUpperCase()}`,
  ];
  for (const [name, record] of Object.entries(schema.records)) {
    const offsets = fieldOffsets(record);
    lines.push(`${name}  (host.rpc 0x${record.id.toString(16).toUpperCase()})`);
    for (const [field, spec] of Object.entries(record.fields)) {
      const range = spec.signed
        ? `${-(1 << (spec.bits - 1))}..${(1 << (spec.bits - 1)) - 1}`
        : `0..${(1 << spec.bits) - 1}`;
      lines.push(`    ${field}  ${spec.bits}b @${offsets[field]}  ${range}${spec.labels ? `  [${spec.labels.join("|")}]` : ""}`);
    }
  }
  return lines;
}

// ── Live source: Open-Meteo ──────────────────────────────────────────────────
//
// Mirrors the request shape and WMO mapping in
// f1-widget-sdk/src/render-v2/weather.mjs. Open-Meteo needs no API key and
// sends permissive CORS headers, so the browser can call it directly.

/** WMO weather code -> the condition ids declared above. */
function conditionFromWmoCode(code: number): number {
  if (code === 0) return 0;                          // clear
  if (code === 1 || code === 2) return 1;            // partly cloudy
  if (code === 3) return 2;                          // cloudy
  if (code === 45 || code === 48) return 3;          // fog
  if (code >= 51 && code <= 57) return 4;            // drizzle
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 5; // rain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 6; // snow
  if (code >= 95) return 7;                          // storm
  return 2;
}

/** Clamp to the declared field width so a freak reading cannot break packing. */
function clampTemperature(value: number): number {
  return Math.max(-511, Math.min(511, Math.round(value)));
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json();
}

const OPEN_METEO_SOURCE: SnapshotSource = {
  label: "Open-Meteo",
  inputLabel: "Place or postal code",
  defaultInput: "Chicago",
  async fetch(input: string) {
    const place = input.trim() || "Chicago";
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}` +
        "&count=1&language=en&format=json",
    );
    const location = geo?.results?.[0];
    if (!location) throw new Error(`No location matched "${place}".`);

    const forecast = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}` +
        `&longitude=${location.longitude}` +
        "&current=temperature_2m,weather_code,is_day" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
        "&temperature_unit=fahrenheit&timezone=auto&forecast_days=4",
    );

    const current = forecast?.current;
    const daily = forecast?.daily;
    if (!current || !daily?.time) throw new Error("Open-Meteo returned no forecast.");

    const values: Record<string, Record<string, number>> = {
      current: {
        temperature: clampTemperature(current.temperature_2m),
        condition: conditionFromWmoCode(current.weather_code),
        isDay: current.is_day ? 1 : 0,
      },
    };
    // Day 0 is today, which the current record already covers.
    (["day1", "day2", "day3"] as const).forEach((name, index) => {
      const at = index + 1;
      values[name] = {
        low: clampTemperature(daily.temperature_2m_min[at]),
        high: clampTemperature(daily.temperature_2m_max[at]),
        condition: conditionFromWmoCode(daily.weather_code[at]),
        weekday: new Date(`${daily.time[at]}T00:00:00`).getDay(),
      };
    });
    return { values, note: `${location.name}, ${location.admin1 ?? location.country ?? ""}`.trim() };
  },
};

/**
 * Bring-your-own-server source. Works for ANY schema: point it at a URL that
 * returns the record values as JSON and the Designer does the rest — packing,
 * staging, commit, decode. Nothing about it is weather-specific.
 *
 * Expected response shape, keyed by the schema's own record and field names:
 *
 *   { "values": { "current": { "temperature": 72, "condition": 0, "isDay": 1 },
 *                 "day1":    { "low": 58, "high": 74, "condition": 0, "weekday": 1 } },
 *     "note": "optional caption" }
 *
 * Values are validated against the declared bit widths before anything is
 * dispatched, so a bad server response fails with a clear message instead of
 * silently rendering nonsense. See examples/host-rpc-server/ for a runnable one.
 */
export function createEndpointSource(schema: SnapshotSchema, defaultUrl: string): SnapshotSource {
  return {
    label: "your server",
    inputLabel: "Endpoint URL (returns { values: { record: { field: n } } })",
    defaultInput: defaultUrl,
    async fetch(url: string) {
      const target = url.trim();
      if (!target) throw new Error("Enter the URL your server listens on.");
      const payload = await fetchJson(target);
      const values = payload?.values;
      if (!values || typeof values !== "object") {
        throw new Error("Response has no `values` object.");
      }
      // Validate against the schema before dispatching anything.
      for (const [name, record] of Object.entries(schema.records)) {
        if (!values[name]) throw new Error(`Response is missing record "${name}".`);
        packRecord(record, values[name]);
      }
      return { values, note: payload.note ?? new URL(target).host };
    },
  };
}

WEATHER_SCHEMA.sources = [
  OPEN_METEO_SOURCE,
  createEndpointSource(WEATHER_SCHEMA, "http://localhost:842/weather"),
];

/**
 * Sources to offer for a schema. Every schema gets the endpoint source — that
 * is what makes "any widget can have a server" true — plus any bespoke API
 * source it declares.
 */
export function sourcesFor(schema: SnapshotSchema, endpointUrl: string): SnapshotSource[] {
  const declared = schema.sources ?? [];
  return [...declared.filter((s) => s.label !== "your server"), createEndpointSource(schema, endpointUrl)];
}
