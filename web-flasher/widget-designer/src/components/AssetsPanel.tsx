import { useMemo, useRef, useState } from "react";
import type { DesignerActions, DesignerState } from "../designer/store";
import {
  WIDGET_ASSET_MAX_TOTAL_BYTES,
  widgetAssetDataUrl,
  widgetAssetReference,
  widgetAssetTotalBytes,
} from "../compiler/widgetAssets";
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "./ui";
import { Icon } from "./icons";

const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(value);
}

/** Authoring-only image bank. Originals stay here/share files; device builds
 * flatten them into the existing compressed base and exact raster variants. */
export function AssetsPanel({ state, actions }: { state: DesignerState; actions: DesignerActions }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const assets = useMemo(() => Object.values(state.assets).sort((a, b) => a.id.localeCompare(b.id)), [state.assets]);
  const total = widgetAssetTotalBytes(state.assets);

  const add = async (files: File[]) => {
    setBusy(true);
    setError("");
    try { await actions.addAssets(files); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const copy = async (id: string, css = false) => {
    const reference = widgetAssetReference(id);
    try {
      await copyText(css ? `url("${reference}")` : reference);
      setCopied(`${id}:${css ? "css" : "url"}`);
      window.setTimeout(() => setCopied(null), 1200);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle>Assets</CardTitle>
            <CardDescription>
              Attach PNG, JPEG, or WebP images, then reference them from HTML or CSS.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => inputRef.current?.click()} busy={busy}>
            {!busy && <Icon name="upload" size={12} />}
            Add images
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = "";
              void add(files);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && <Callout tone="danger" className="m-4 mb-0">{error}</Callout>}
        {assets.length === 0 ? (
          <EmptyState
            size="sm"
            title="No images attached"
            hint={<>Add an image, then use <code>asset://name</code> in an img src or CSS url().</>}
            action={<Button size="sm" onClick={() => inputRef.current?.click()}>Add image</Button>}
          />
        ) : (
          <div className="wd-assets-list">
            {assets.map((asset) => (
              <div className="wd-assets-row" key={asset.id}>
                <div className="wd-assets-thumb" aria-hidden="true">
                  <img src={widgetAssetDataUrl(asset)} alt="" />
                </div>
                <div className="wd-assets-main">
                  <div className="wd-assets-name" title={asset.name}>{asset.name}</div>
                  <code>{widgetAssetReference(asset.id)}</code>
                  <span>{asset.width}×{asset.height} · {formatBytes(asset.bytes)}</span>
                </div>
                <div className="wd-assets-actions">
                  <Button size="sm" variant="ghost" onClick={() => void copy(asset.id)}>
                    <Icon name={copied === `${asset.id}:url` ? "check" : "copy"} size={12} />
                    {copied === `${asset.id}:url` ? "Copied" : "URL"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void copy(asset.id, true)}>
                    <Icon name={copied === `${asset.id}:css` ? "check" : "copy"} size={12} />
                    {copied === `${asset.id}:css` ? "Copied" : "CSS"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${asset.name}`}
                    onClick={() => actions.removeAsset(asset.id)}
                  >
                    <Icon name="x" size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="wd-assets-foot">
          <span>Authoring files</span>
          <Badge tone="neutral" className="wd-nums">
            {formatBytes(total)} / {formatBytes(WIDGET_ASSET_MAX_TOTAL_BYTES)}
          </Badge>
          <span>Device cost is measured from built RGB565 pixels, not these originals.</span>
        </div>
      </CardContent>
    </Card>
  );
}
