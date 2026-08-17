import { createHash } from "node:crypto";

import { prepareRenderV2, linkRenderV2 } from "./compiler.mjs";
import { buildRenderV2Package } from "./package.mjs";

function invariant(value, message) { if (!value) throw new Error(message); }

function sourceDigest({ html, css, script, rootClass }) {
  const digest = createHash("sha256");
  [["html", html], ["css", css], ["script", script], ["rootClass", rootClass]].forEach(([name, value]) =>
    digest.update(name).update("\0").update(value).update("\0"));
  return digest.digest("hex");
}

/** Public end-to-end compiler: source -> F1SC preparation -> RGB565 patches -> F1WB+F2EP package. */
export async function compileRenderV2Widget({ html, css, script, rootClass = "render-v2",
  name = "render-v2", generation = 1, atlas, atlasFactory, programEncoder } = {}) {
  const prepared = prepareRenderV2({ html, css, script, rootClass });
  const resolvedAtlas = atlas ?? await atlasFactory?.(prepared.scene.glyphs);
  invariant(resolvedAtlas, "Render v2 compilation requires atlas or atlasFactory(glyphs).");
  const linked = linkRenderV2(prepared, { atlas: resolvedAtlas, ...(programEncoder ? { programEncoder } : {}) });
  const packageValue = buildRenderV2Package(linked, { name, generation });
  const sha256 = sourceDigest({ html, css, script, rootClass });
  const manifest = Object.freeze({ format: "framer-render-v2-compilation-v1", sha256,
    source: Object.freeze({ sha256, htmlBytes: Buffer.byteLength(html), cssBytes: Buffer.byteLength(css),
      scriptBytes: Buffer.byteLength(script), rootClass }),
    execution: packageValue.execution, scene: Object.freeze({ sha256: prepared.scene.sha256,
      bytes: prepared.sceneBinary.length, glyphs: prepared.scene.glyphs.length,
      atlasSha256: resolvedAtlas.sha256, atlasBytes: resolvedAtlas.binary.length }),
    program: packageValue.program, package: Object.freeze({ format: packageValue.format,
      bytes: packageValue.binary.length, sha256: packageValue.sha256 }),
    budget: packageValue.budget, compatibility: packageValue.compatibility });
  return Object.freeze({ format: manifest.format, sha256, prepared, linked, package: packageValue, manifest });
}
