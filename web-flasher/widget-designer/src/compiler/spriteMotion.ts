import { rgbTo565 } from "./renderV2Package";
import { widgetAssetDataUrl, type WidgetAsset, type WidgetAssetMap } from "./widgetAssets";
import type { WidgetMotionTargetSource } from "./widgetAssembler";

export interface PreviewMotionProbe {
  tagName: string;
  eligible: boolean;
  reason: string;
  opacity: number;
  visualKey: string;
}

/** Return the attached asset used by an exact <img id="…">. Compact motion
 * deliberately excludes CSS backgrounds and remote/data URLs: those continue
 * through the design-true raster path. */
export function attachedImageAssetForTarget(
  html: string,
  id: string,
  assets: WidgetAssetMap,
): WidgetAsset | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const node = document.getElementById(id);
  if (!node || node.tagName !== "IMG") return null;
  const match = /^asset:\/\/([a-z][a-z0-9-]{0,47})$/u.exec(node.getAttribute("src") ?? "");
  return match && Object.prototype.hasOwnProperty.call(assets, match[1]) ? assets[match[1]] : null;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The attached motion image could not be decoded."));
    image.src = source;
  });
}

/** Decode and resize the authoring image exactly once. The compressed source
 * never enters F2UP; v4 stores only device-sized RGB565 and alpha8 planes. */
export async function rasterizeMotionImage(
  asset: WidgetAsset,
  width: number,
  height: number,
  opacity = 1,
): Promise<Pick<WidgetMotionTargetSource, "colors" | "alpha">> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Motion image dimensions must be positive integers; got ${width}×${height}.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not acquire a canvas for the attached motion image.");
  const image = await loadImage(widgetAssetDataUrl(asset));
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const colors = new Uint16Array(width * height);
  const alpha = new Uint8Array(width * height);
  const opacity8 = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  for (let pixel = 0; pixel < colors.length; pixel += 1) {
    const at = pixel * 4;
    colors[pixel] = rgbTo565(rgba[at], rgba[at + 1], rgba[at + 2]);
    alpha[pixel] = Math.round(rgba[at + 3] * opacity8 / 255);
  }
  return { colors, alpha };
}
