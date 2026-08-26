// Side-effect module: installs the Node globals the SDK's render-v2 chain
// assumes, at MODULE EVALUATION time.
//
// This has to be a side-effect import rather than a function call, because ES
// module imports are hoisted: every `import` in a file is evaluated before any
// statement in that file's body. Calling installBufferShim() from the app entry
// was therefore too late — `render/glyph-atlas.mjs` runs
// `Buffer.from("F1GA", "ascii")` at its own top level, so it threw
// "Buffer is not defined" before the entry body ever ran, and the app rendered
// a blank page.
//
// Import this FIRST in any module that imports the SDK. ES modules evaluate
// depth-first in import order, so listing it above the SDK import guarantees
// the globals exist by the time the SDK body runs.

import { installBufferShim } from "./buffer";

installBufferShim();
