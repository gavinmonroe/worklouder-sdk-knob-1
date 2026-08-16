import { readFile } from "node:fs/promises";

function rgba(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/iu.test(hex)) {
    throw new Error(`Invalid fixture color ${hex}.`);
  }
  return [...Buffer.from(hex.slice(1), "hex"), 255];
}

export class JsonFixtureMediaAdapter {
  constructor(fixturePath) {
    this.fixturePath = fixturePath;
  }

  async getCurrentMedia() {
    const fixture = JSON.parse(await readFile(this.fixturePath, "utf8"));
    if (fixture.albumArt?.format !== "hex-grid-rgba8-fixture") {
      throw new Error("Mock adapter requires hex-grid-rgba8-fixture album art.");
    }
    const pixels = Buffer.from(fixture.albumArt.pixels.flatMap(rgba));
    return {
      title: fixture.title,
      artist: fixture.artist,
      durationMs: fixture.durationMs,
      positionMs: fixture.positionMs,
      albumArt: {
        format: "rgba8",
        width: fixture.albumArt.width,
        height: fixture.albumArt.height,
        pixels,
      },
    };
  }
}
