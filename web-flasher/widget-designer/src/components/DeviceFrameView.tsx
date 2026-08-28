import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { Button, Spinner } from "./ui";
import { Icon } from "./icons";
import { runAssemble, useAssembleStatus } from "./assembleAction";
import { useF2upStatus } from "./f2upStatus";
import { decodeUploadContainer } from "../compiler/uploadContainer";
import { decodeLzss } from "../compiler/lzss";
import { BASE_FRAME_BYTES } from "../compiler/frameCapture";
import { DEVICE_WIDTH, DEVICE_HEIGHT } from "../compiler/renderV2Package";
import {
  TARGET_FACADE_CONTRACT_V3_SHA256,
  TARGET_FACADE_CONTRACT_V4_SHA256,
  TARGET_FACADE_CONTRACT_V5_SHA256,
} from "../compiler/f2tfPackage";
import {
  decodeTargetFacadeAsset,
  renderTargetFacadeHost,
  TARGET_FACADE_RESULT,
} from "../compiler/targetFacadeOracle";
import { mailboxFromDeviceSlots, freshRenderState } from "../compiler/mailboxFromSim";
import { rgb565FrameToRgba } from "../compiler/rgb565ToRgba";

/**
 * The Device frame: the ACTUAL 100×310 RGB565 raster the F1 draws, rendered
 * from the SAME assembled F2UP container the push uploads, through the SAME
 * target-facade oracle the hardware path is proven against. It is a VIEW of
 * existing truth — the capture-gate sha already proves the browser assembly
 * equals the pushed bytes, so this canvas is the device output by construction.
 *
 * Pipeline (decode once per container, memoized on its base64; render+paint per
 * sim event):
 *   f2up.base64 → decodeUploadContainer → { f2tf, lzss, generation, f2jsSha256 }
 *   lzss → decodeLzss → Uint16Array baseFrame
 *   f2tf → decodeTargetFacadeAsset → facade
 *   deviceSlots → mailboxFromDeviceSlots → renderTargetFacadeHost → RGB565 frame
 *   frame → rgb565FrameToRgba → ImageData → <canvas>, scaled by the stage zoom.
 *
 * The canvas paints raw device pixels — NEVER themed. Only its surrounding
 * states (assemble prompt, decoding, non-ok result) are app chrome and follow
 * the app theme via tokens.
 */

interface DecodedContainer {
  facade: unknown;
  baseFrame: Uint16Array;
  generation: number;
}

/** Reverse map of TARGET_FACADE_RESULT — kept for the diagnostic detail. */
const RESULT_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(TARGET_FACADE_RESULT).map(([name, value]) => [value as number, name]),
);

/** What each render outcome MEANS, and what to do about it. The chip must tell
 *  a designer their next move, not name an internal enum. */
function explainRenderResult(result: number): string {
  const name = RESULT_NAME[result] ?? "error";
  if (/torn/i.test(name)) return "The preview updated mid-frame — try again.";
  if (/generation|format|contract/i.test(name)) return "This build is out of date — build the widget again.";
  if (/overflow|bounds/i.test(name)) return "Something is drawn outside the screen — check your element positions.";
  if (/thread|owner/i.test(name)) return "The preview lost sync — reload the page.";
  return "The keyboard couldn't draw this widget.";
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function DeviceFrameView({
  state,
  actions,
  visible,
  zoom,
}: {
  state: DesignerState;
  actions: DesignerActions;
  visible: boolean;
  zoom: number;
}) {
  const source = useMemo(
    () => ({ html: state.html, css: state.css, js: state.js }),
    [state.html, state.css, state.js],
  );
  const f2up = useF2upStatus(source);
  const { busy: assembling } = useAssembleStatus(source);
  const base64 = f2up?.base64 ?? null;

  const [decoded, setDecoded] = useState<DecodedContainer | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Decode ONCE per container. decodeUploadContainer verifies the sha the
  // capture gate pins, so a decode failure here would mean the browser bytes
  // are not the pushed bytes — surfaced honestly rather than papered over.
  useEffect(() => {
    if (!base64) {
      setDecoded(null);
      setDecodeError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const container = await decodeUploadContainer(base64ToBytes(base64));
        const baseBytes = decodeLzss(container.lzss, BASE_FRAME_BYTES);
        const baseFrame = new Uint16Array(BASE_FRAME_BYTES / 2);
        for (let i = 0; i < baseFrame.length; i += 1) {
          baseFrame[i] = baseBytes[i * 2] | (baseBytes[i * 2 + 1] << 8);
        }
        const embeddedContract = [...container.f2tf.subarray(160, 192)]
          .map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (embeddedContract !== TARGET_FACADE_CONTRACT_V3_SHA256 &&
            embeddedContract !== TARGET_FACADE_CONTRACT_V4_SHA256 &&
            embeddedContract !== TARGET_FACADE_CONTRACT_V5_SHA256) {
          throw new Error(`Unsupported target-facade contract ${embeddedContract.slice(0, 12)}…`);
        }
        const facade = decodeTargetFacadeAsset(container.f2tf, {
          expectedGeneration: container.generation,
          expectedF2jsSha256: container.f2jsSha256,
          expectedContractSha256: embeddedContract,
        });
        if (cancelled) return;
        setDecoded({ facade, baseFrame, generation: container.generation });
        setDecodeError(null);
      } catch (err) {
        if (cancelled) return;
        setDecoded(null);
        setDecodeError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base64]);

  // Render + paint per sim event. Fresh render state each paint: the Device
  // frame always shows the LATEST committed slots, so lastAppliedRevision=0
  // always admits them (see mailboxFromSim). Only ok/hidden produce a real
  // frame; every other result is a torn/generation/format gate the chip names.
  useEffect(() => {
    if (!visible || !decoded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const mailbox = mailboxFromDeviceSlots(state.deviceSlots, decoded.generation);
      const { result, frame } = renderTargetFacadeHost({
        decoded: decoded.facade,
        baseFrame: decoded.baseFrame,
        mailbox,
        state: freshRenderState(),
        expectedGeneration: decoded.generation,
      });
      setRenderResult(result);
      if (result === TARGET_FACADE_RESULT.ok || result === TARGET_FACADE_RESULT.hidden) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const rgba = rgb565FrameToRgba(frame as Uint16Array);
          const image = ctx.createImageData(DEVICE_WIDTH, DEVICE_HEIGHT);
          image.data.set(rgba);
          ctx.putImageData(image, 0, 0);
        }
      }
    } catch {
      setRenderResult(-1);
    }
  }, [visible, decoded, state.deviceSlots]);

  if (!visible) return null;

  const hasContainer = !!base64;
  // A generation gate would mean the container and facade disagree — that
  // cannot happen here (both come from the one decoded container), but any
  // non-ok result is still surfaced rather than silently blanked.
  const nonOk =
    renderResult !== null &&
    renderResult !== TARGET_FACADE_RESULT.ok &&
    renderResult !== TARGET_FACADE_RESULT.hidden;

  return (
    <div className="wd-device-view" aria-label="Device frame — on-device raster">
      {/* Live device raster. width/height are PHYSICAL device pixels; the stage
          zoom scales it from the top-left exactly like the design iframe, so
          Design and Device modes register pixel-for-pixel. image-rendering
          pixelated keeps the device pixels crisp at every zoom. */}
      {hasContainer && (
        <canvas
          ref={canvasRef}
          width={DEVICE_WIDTH}
          height={DEVICE_HEIGHT}
          className="wd-device-canvas"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            imageRendering: "pixelated",
          }}
        />
      )}

      {/* No container for THIS source: a one-click assemble into the SAME shared
          action the Export tab and push use — never a parallel assemble path. */}
      {!hasContainer && (
        <div className="wd-device-state" role="status">
          {assembling ? (
            <>
              <Spinner size={22} />
              <span className="wd-device-state-title">Building the widget…</span>
              <span className="wd-device-state-hint">
                Rendering it the way the keyboard will
              </span>
            </>
          ) : (
            <>
              <Icon name="keyboard" size={22} />
              <span className="wd-device-state-title">Build the widget to see it on the keyboard screen</span>
              <span className="wd-device-state-hint">
                This is exactly what the keyboard screen will show.
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void runAssemble(actions, source)}
              >
                <Icon name="play" size={14} />
                Build widget
              </Button>
            </>
          )}
        </div>
      )}

      {/* Decode failure: the browser bytes did not verify as an F2UP container.
          This is a real integrity signal, not cosmetic — name it. */}
      {hasContainer && decodeError && (
        <div className="wd-device-state" role="status" data-tone="error">
          <Icon name="alert-triangle" size={20} />
          <span className="wd-device-state-title">Couldn't render the keyboard preview</span>
          <span className="wd-device-state-hint wd-nums">{decodeError}</span>
        </div>
      )}

      {/* Non-ok oracle result: the device would not paint either. The chip names
          the exact facade result (torn / generation / format / overflow / …). */}
      {hasContainer && !decodeError && nonOk && (
        <div className="wd-device-chip" role="status">
          <Icon name="alert-triangle" size={12} />
          <span title={`render result: ${RESULT_NAME[renderResult as number] ?? "error"}`}>
            {explainRenderResult(renderResult as number)}
          </span>
        </div>
      )}
    </div>
  );
}
