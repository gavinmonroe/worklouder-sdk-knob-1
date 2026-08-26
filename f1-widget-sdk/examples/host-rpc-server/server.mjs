#!/usr/bin/env node
// Minimal host RPC server for the Widget Designer.
//
// The Designer's "your server" source GETs a URL and expects the record values
// for a schema, keyed by the schema's own record and field names. It does the
// rest: packing to int32 payloads, the begin/record/commit sequence, staging,
// revision matching, and decoding in the widget.
//
// So a host is just "return some numbers as JSON". No bit packing, no RPC ids,
// no protocol knowledge.
//
//   node server.mjs                 # http://localhost:842/weather
//   node server.mjs --port 9000
//
// Then in the Designer: Events -> Weather snapshot -> "Fetch live from your
// server" with the URL. Point it at your own process to drive any widget.
//
// The response shape, for the weather schema in
// web-flasher/widget-designer/src/data/schemas.ts:
//
//   {
//     "values": {
//       "current": { "temperature": 72, "condition": 0, "isDay": 1 },
//       "day1":    { "low": 58, "high": 74, "condition": 0, "weekday": 1 },
//       "day2":    { ... }, "day3": { ... }
//     },
//     "note": "shown in the Designer after a successful fetch"
//   }
//
// Field names, widths and signedness come from the schema; values outside a
// declared width are rejected by the Designer with a message naming the field,
// rather than silently wrapping.

import { createServer } from "node:http";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const PORT = portIndex >= 0 ? Number(args[portIndex + 1]) : 842;

/**
 * Replace this with whatever you actually want on the panel — a home-automation
 * reading, a build status, a stock price, a countdown. Anything that can be
 * expressed as small integers fits.
 */
function readWeather() {
  const now = new Date();
  // Stand-in data that visibly changes, so you can see pushes land.
  const temperature = 68 + (now.getMinutes() % 12);
  const condition = now.getMinutes() % 8;          // 0..7, see CONDITIONS
  const day = (index) => ({
    low: 55 + index * 2,
    high: 70 + index * 3,
    condition: (condition + index) % 8,
    weekday: (now.getDay() + index + 1) % 7,
  });
  return {
    values: {
      current: { temperature, condition, isDay: now.getHours() >= 6 && now.getHours() < 20 ? 1 : 0 },
      day1: day(0),
      day2: day(1),
      day3: day(2),
    },
    note: `local server ${now.toLocaleTimeString()}`,
  };
}

const ROUTES = {
  "/weather": readWeather,
};

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const handler = ROUTES[url.pathname];

  // The Designer runs in a browser on a different origin, so CORS is required.
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!handler) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: `No route ${url.pathname}. Try ${Object.keys(ROUTES).join(", ")}.` }));
    return;
  }

  try {
    const body = JSON.stringify(handler(url));
    response.setHeader("content-type", "application/json");
    response.end(body);
    console.log(`${request.method} ${url.pathname} -> ${body.length} bytes`);
  } catch (cause) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(cause?.message ?? cause) }));
  }
});

server.listen(PORT, () => {
  console.log(`Host RPC server on http://localhost:${PORT}`);
  for (const route of Object.keys(ROUTES)) console.log(`  http://localhost:${PORT}${route}`);
  console.log("\nDesigner: Events -> Weather snapshot -> Fetch live from your server");
});
