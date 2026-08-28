# Local development setup

How to take a fresh clone to a suite where every remaining skip states its own
reason. None of this needs a Framer F1 attached.

## Requirements

- Node 22 or newer. Verified on v22.23.2.
- macOS or Linux. Two pinned inputs below are macOS-specific.

Runtime dependencies are vendored: `f1-widget-sdk/node_modules` and
`web-flasher/node_modules` are committed, so no `npm install` is required to run
the test suites.

## Baseline

With nothing beyond Node installed:

```sh
npm --prefix f1-widget-sdk test    # 313 pass, 22 skip, 1 known failure
npm --prefix f1-cli test           # 12 pass
npm --prefix framer-widgets test   # 13 pass, 1 skip
```

Every skip prints why the input is unavailable. Derived firmware images under
`custom-firmware/build/` do not need to be built by hand; the suites that need
one regenerate it when the toolchain below is present.

## Optional: Xtensa ESP32-S3 toolchain

Unlocks 3 assembler-backed tests and lets the SDK regenerate derived images.
`.toolchains/` is gitignored. Install the exact pinned release:

```sh
mkdir -p .toolchains && cd .toolchains
curl -L -o xt.tar.xz \
  https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/xtensa-esp-elf-13.2.0_20240530-aarch64-apple-darwin.tar.xz
tar -xf xt.tar.xz && rm xt.tar.xz
mv xtensa-esp-elf xtensa-esp-elf-13.2.0_20240530
```

Use the `x86_64-apple-darwin` or `*-linux-gnu` asset from the same release on
other hosts. `PINNED.toolchain` in `f1-widget-sdk/src/constants.mjs` holds the
SHA-256 of each binary; verify before trusting the download:

```sh
cd .toolchains/xtensa-esp-elf-13.2.0_20240530/bin
for t in as ld objcopy objdump readelf nm; do
  shasum -a 256 "xtensa-esp32s3-elf-$t"
done
```

All six must match `PINNED.toolchain`. Result: 316 pass, 19 skip.

## Optional: pinned Chrome

Unlocks 7 raster-golden tests. The goldens are pinned to
`Chrome/151.0.7922.138`, and this is deliberately not a pin to relax: the note at
`f1-widget-sdk/input-lab/test/render-v2-raster.test.mjs:96` records that a
different build shifted a reference frame by 124 RGB565 pixels. Install Chrome
for Testing alongside your normal browser rather than downgrading it:

```sh
cd .toolchains
curl -L -o chrome.zip \
  https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.138/mac-arm64/chrome-mac-arm64.zip
unzip -q chrome.zip -d chrome-151.0.7922.138 && rm chrome.zip
xattr -dr com.apple.quarantine chrome-151.0.7922.138
```

Point the suite at it, since it is not the platform default path:

```sh
export INPUT_LAB_CHROME_PATH="$PWD/.toolchains/chrome-151.0.7922.138/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
npm --prefix f1-widget-sdk test    # 323 pass, 12 skip
```

`hosted/deploy.md` covers the Linux service install of the same pin.

## Optional: ImageMagick

`framer-widgets` shells out to `magick` to verify normalized sprite frames.

```sh
brew install imagemagick
```

The SDK's own `rasterizeGlyphAtlasWithMagick` additionally pins
`ImageMagick 7.1.2-21`; a newer Homebrew build runs the `framer-widgets` test but
not that path.

## Inputs a contributor cannot reproduce

Two pinned inputs stay skipped no matter what you install. This is expected.

| Input | Why |
| --- | --- |
| `recovery/backups/2026-08-15-.../full-flash-16mb.bin` | A byte-exact 16 MiB dump of the maintainer's own F1 (MAC `a4:cb:8f:af:32:10`). `recovery/backups/` is gitignored and the pinned SHA-256 belongs to that one device, so attaching your own F1 produces a different image. Skips 11 tests. |
| `/System/Library/Fonts/Hiragino Sans GB.ttc` | The glyph atlas pins one SHA-256 of a font that ships with macOS and changes between OS versions. Skips 1 test. |

## Known failure

`test/device-workflow-live-rollback.test.mjs:174` fails on `main`, independent of
your environment. Commit `e7d3522` (2026-08-26) re-pinned
`combined-renderer-v2-generic-input-lab-device-approval.json` to app SHA-256
`4e045ec2…`, while the capability-ABI freeze in `src/device-workflow.mjs` still
names `371ee26e…` and the test was last updated in `32581fc` (2026-08-17). The
approval therefore validates cleanly and the expected throw never happens. Every
negative mutation in that test still throws, so the gates themselves are intact.
