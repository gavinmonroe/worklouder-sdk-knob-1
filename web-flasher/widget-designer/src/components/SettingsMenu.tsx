// Settings menu — the quiet home for shell-level switches. Today it holds
// exactly one: "Legacy tools", which reveals the older F2JS / render-v2 build
// paths the platform has moved past (the v3 mquickjs pipeline is the default
// experience). A gear icon button in the topbar opens a small popover.

import * as React from "react";
import { Popover, Tooltip } from "./ui";
import { Icon } from "./icons";
import { setLegacyTools, useLegacyTools } from "./legacyTools";

export function SettingsMenu() {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const legacy = useLegacyTools();

  return (
    <>
      <Tooltip label="Settings">
        <button
          type="button"
          ref={btnRef}
          className="wd-iconbtn"
          data-size="lg"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="gear" />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} aria-label="Designer settings">
        <div className="wd-menu">
          <button
            type="button"
            className="wd-menurow"
            role="switch"
            aria-checked={legacy}
            onClick={() => setLegacyTools(!legacy)}
          >
            <span className="wd-menurow-main">
              <span className="wd-menurow-label">Legacy tools</span>
              <span className="wd-menurow-caption">
                Show the older F2JS / render-v2 build paths
              </span>
            </span>
            <span className="wd-switch" data-on={legacy || undefined} aria-hidden="true">
              <span className="wd-switch-thumb" />
            </span>
          </button>
        </div>
      </Popover>
    </>
  );
}
