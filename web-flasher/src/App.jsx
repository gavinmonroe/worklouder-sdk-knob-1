import { firmwareCatalog } from "./data/firmware.js";
import { framerLayout, framerModelName } from "./lib/device-identity.js";
import { useFlasher } from "./hooks/useFlasher.js";

function formatBytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function StatusMark({ state }) {
  const label = state === "done" ? "Complete" : state === "active" ? "In progress" : "Not started";
  return <span className={`status-mark status-mark--${state}`} aria-label={label}>{state === "done" ? "✓" : ""}</span>;
}

function FirmwareOption({ firmware, selected, disabled, onSelect }) {
  const evidenceTone = firmware.evidenceTone ?? (firmware.flashable ? "accepted" : "preview");
  return (
    <label className={`firmware-option ${selected ? "firmware-option--selected" : ""} ${!firmware.flashable ? "firmware-option--preview" : ""}`}>
      <input
        type="radio"
        name="firmware"
        value={firmware.id}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect(firmware.id)}
      />
      <span className={`firmware-swatch firmware-swatch--${firmware.accent}`} aria-hidden="true" />
      <span className="firmware-copy">
        <span className="firmware-name-row">
          <strong>{firmware.name}</strong>
          <span className={`evidence evidence--${evidenceTone}`}>{firmware.evidence}</span>
        </span>
        <span className="firmware-description">{firmware.description}</span>
        <span className="firmware-includes">
          <strong>Includes:</strong> {firmware.includes.join(" + ")}
        </span>
        <span className="firmware-meta">
          {firmware.detail} · {formatBytes(firmware.bytes)} · {shortHash(firmware.sha256)}
        </span>
      </span>
    </label>
  );
}

function BrowserNotice({ capabilities }) {
  const missing = [
    !capabilities.secureContext && "localhost or HTTPS",
    !capabilities.webHid && "WebHID",
    !capabilities.webSerial && "Web Serial",
  ].filter(Boolean);
  return (
    <section className="browser-notice" role="alert">
      <strong>This browser cannot flash the keyboard.</strong>
      <p>Open this app in desktop Chrome or Edge using localhost or HTTPS. Missing: {missing.join(", ")}.</p>
    </section>
  );
}

function Step({ number, title, state, children }) {
  return (
    <section className={`step step--${state}`}>
      <div className="step-heading">
        <div>
          <span className="step-number">{number}</span>
          <h2>{title}</h2>
        </div>
        <StatusMark state={state} />
      </div>
      <div className="step-body">{children}</div>
    </section>
  );
}

function DeviceSummary({ device, version, identity }) {
  return (
    <div className="device-summary">
      <div className="device-drawing" aria-hidden="true">
        <span className="device-screen" />
        <span className="device-keys" />
      </div>
      <div>
        <strong>{framerModelName(device.productId)} · {framerLayout(device.productId)}</strong>
        <span>Firmware {version}</span>
        <span>{identity.mode === "hid-serial" ? `Serial ${identity.serialNumber}` : "Identity: single connected device"}</span>
      </div>
    </div>
  );
}

function SingleDeviceConfirmation({ checked, disabled, onChange }) {
  return (
    <label className="identity-confirmation">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>Only this Framer/Knob F1 is connected</strong>
        <small>Chrome did not expose its HID serial on this site. Disconnect other supported keyboards before continuing.</small>
      </span>
    </label>
  );
}

function DownloadReceipt({ receipt }) {
  const download = () => {
    const blob = new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `framer-f1-web-receipt-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <button className="button button--secondary" onClick={download}>Download receipt</button>;
}

function PreviewOnly({ firmware }) {
  return (
    <section className="preview-workflow" aria-labelledby="preview-title">
      <div className="preview-stage" aria-hidden="true">
        <div className="preview-device">
          <div className="preview-code">
            <span>&lt;div class="widget"&gt;</span>
            <span>&nbsp;&nbsp;&lt;h1&gt;Hello F1&lt;/h1&gt;</span>
            <span>&lt;/div&gt;</span>
          </div>
          <div className="preview-render">
            <span>HELLO</span>
            <strong>F1</strong>
          </div>
        </div>
      </div>
      <div className="preview-copy">
        <span className="preview-kicker">Browser preview available</span>
        <h2 id="preview-title">{firmware.name}</h2>
        <p>{firmware.blockedReason}</p>
        <dl className="preview-checks">
          <div><dt>Static compiler</dt><dd>Ready</dd></div>
          <div><dt>Device renderer</dt><dd>Awaiting approval</dd></div>
          <div><dt>USB actions</dt><dd>Disabled</dd></div>
        </dl>
      </div>
    </section>
  );
}

const NOTICE_TITLES = {
  "Smoke candidate": "Device smoke candidate",
  "Live tested canary": "Live-tested canary, outside the audited release pipeline",
  "Live accepted": "Before you flash",
};

function CandidateNotice({ firmware }) {
  if (!firmware.notice) return null;
  return (
    <div className="candidate-notice" role="note">
      <strong>{NOTICE_TITLES[firmware.evidence] ?? "Before you flash"}</strong>
      <p>{firmware.notice}</p>
    </div>
  );
}

function HostCompanionNotice({ companion }) {
  if (!companion) return null;
  return (
    <div className="host-companion-notice" role="note">
      <div>
        <strong>{companion.title}</strong>
        <p>{companion.description}</p>
      </div>
      <a className="button button--secondary" href={companion.url} download={companion.filename}>
        Download {companion.platform} host companion
      </a>
    </div>
  );
}

export function ScenePackageNotice({ firmware, scene, supported, onEnable }) {
  const scenePackage = firmware.scenePackage;
  if (!scenePackage) return null;
  const label =
    scene.phase === "pushing" ? `Pushing ${scene.progress}%` :
      scene.phase === "committing" ? "Applying…" :
        scene.phase === "enabled" ? "Push again" : scenePackage.actionLabel;
  return (
    <div className="scene-notice" role="note">
      <div className="scene-copy">
        <strong>{scenePackage.title}</strong>
        <p>{scenePackage.description}</p>
        <p className="scene-meta">
          {formatBytes(scenePackage.bytes)} · {scenePackage.chunks} chunks · generation{" "}
          {scenePackage.expectedGeneration} → {scenePackage.generation} · {shortHash(scenePackage.sha256)}
        </p>
        {scene.result && (
          <p className="scene-status" role="status">
            {scene.result.alreadyEnabled
              ? `Already enabled by firmware (generation ${scene.result.generation}). No push was needed.`
              : `Enabled (generation ${scene.result.generation}) · ${scene.result.chunks} chunks accepted.`}
            {" "}It stays live until the keyboard is power-cycled, unless this firmware build persists the push
            to flash.
          </p>
        )}
        {scene.error && <p className="scene-error" role="alert">{scene.error}</p>}
      </div>
      <button
        className="button button--secondary"
        disabled={!supported || scene.busy}
        onClick={onEnable}
      >
        {label}
      </button>
    </div>
  );
}

export function WriteScopeAddresses({ firmware }) {
  if (!firmware.flashable) return <dd>—</dd>;
  if (!firmware.regions) return <dd>0x10000</dd>;
  return (
    <dd>
      <ul className="region-list">
        {firmware.regions.map((region) => (
          <li key={region.address}>
            <code>0x{region.address.toString(16)}</code> {region.label} ({region.bytes.toLocaleString()} B)
          </li>
        ))}
      </ul>
    </dd>
  );
}

export default function App() {
  const flasher = useFlasher();
  const busy = ["identifying", "preparing", "selecting-port", "checking-bootloader", "flashing", "verifying-boot", "recovering-bootloader"].includes(flasher.phase);
  const identified = Boolean(flasher.device);
  const bootloaderReady = flasher.bootloaderReady || flasher.phase === "complete";
  const completed = flasher.phase === "complete";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">F1</div>
        <div className="header-copy">
          <h1>Framer F1 Flasher</h1>
          <p>Local widget installer and preview</p>
        </div>
        <div className="header-requirement">Chrome · USB · Firmware 0.4.1</div>
      </header>

      {!flasher.supported && flasher.selected.flashable && <BrowserNotice capabilities={flasher.capabilities} />}

      <main className="main-layout">
        <section className="catalog-panel" aria-labelledby="catalog-title">
          <div className="section-heading">
            <div>
              <h2 id="catalog-title">Choose widget</h2>
              <p>Every installable image is pinned to its generated approval evidence.</p>
            </div>
            <span>{firmwareCatalog.length} widgets</span>
          </div>

          <div className="firmware-list">
            {firmwareCatalog.map((firmware) => (
              <FirmwareOption
                key={firmware.id}
                firmware={firmware}
                selected={flasher.selectedId === firmware.id}
                disabled={busy || bootloaderReady}
                onSelect={flasher.selectFirmware}
              />
            ))}
          </div>

          <div className="write-scope">
            <strong>Write scope</strong>
            <dl>
              <div><dt>Target</dt><dd>Framer F1 / Knob F1</dd></div>
              <div>
                <dt>{flasher.selected.regions ? "Addresses" : "Address"}</dt>
                <WriteScopeAddresses firmware={flasher.selected} />
              </div>
              <div>
                <dt>Mode</dt>
                <dd>
                  {!flasher.selected.flashable ? "Preview only" :
                    flasher.selected.regions
                      ? "Module pages, then factory app"
                      : "Factory app only"}
                </dd>
              </div>
              <div><dt>Includes</dt><dd>{flasher.selected.includes.join(" + ")}</dd></div>
              {flasher.selected.scenePackage && (
                <div>
                  <dt>After boot</dt>
                  <dd>{flasher.selected.scenePackage.actionLabel} (RAM only)</dd>
                </div>
              )}
              {flasher.selected.compilerUrl && (
                <div>
                  <dt>Compiler</dt>
                  <dd><a href={flasher.selected.compilerUrl} target="_blank" rel="noreferrer">Open HTML/CSS compiler</a></dd>
                </div>
              )}
              {flasher.selected.hostCompanion && (
                <div>
                  <dt>Host companion</dt>
                  <dd><a href={flasher.selected.hostCompanion.url}
                    download={flasher.selected.hostCompanion.filename}>Download {flasher.selected.hostCompanion.platform} ZIP</a></dd>
                </div>
              )}
              <div><dt>Erase all</dt><dd>Never</dd></div>
            </dl>
          </div>
        </section>

        {flasher.selected.flashable ? <section className="workflow-panel" aria-label="Flash workflow">
          <HostCompanionNotice companion={flasher.selected.hostCompanion} />
          <CandidateNotice firmware={flasher.selected} />
          <ScenePackageNotice
            firmware={flasher.selected}
            scene={flasher.scene}
            supported={flasher.capabilities.webHid && flasher.capabilities.secureContext}
            onEnable={flasher.enableScenePackage}
          />
          <Step number="01" title="Identify keyboard" state={identified ? "done" : flasher.phase === "identifying" ? "active" : "idle"}>
            {identified ? (
              <>
                <DeviceSummary device={flasher.device} version={flasher.version} identity={flasher.normalIdentity} />
                {flasher.normalIdentity.mode === "single-device" && (
                  <SingleDeviceConfirmation
                    checked={flasher.singleDeviceConfirmed}
                    disabled={busy || bootloaderReady}
                    onChange={flasher.confirmSingleDevice}
                  />
                )}
              </>
            ) : (
              <>
                <p>Quit Work Louder Input, then connect the keyboard directly by USB. Chrome will only show supported Framer F1 devices.</p>
                <button
                  className="button button--primary"
                  disabled={!flasher.supported || busy}
                  onClick={flasher.connectKeyboard}
                >
                  {flasher.phase === "identifying" ? "Checking keyboard…" : "Connect keyboard"}
                </button>
                <div className="recovery-action">
                  <button
                    className="button button--quiet"
                    disabled={busy}
                    onClick={flasher.exitBootloader}
                  >
                    {flasher.phase === "recovering-bootloader" ? "Resetting bootloader…" : "Keyboard already in bootloader?"}
                  </button>
                  <span>Exit without writing firmware</span>
                </div>
              </>
            )}
          </Step>

          <Step number="02" title="Enter bootloader" state={bootloaderReady ? "done" : flasher.phase === "preparing" ? "active" : "idle"}>
            <p>The selected binary is checked before the keyboard leaves normal mode. Work Louder Input should be closed.</p>
            {!bootloaderReady && (
              <button
                className="button button--secondary"
                  disabled={
                    !identified ||
                    busy ||
                    completed ||
                    !flasher.selected.flashable ||
                    (flasher.normalIdentity?.mode === "single-device" && !flasher.singleDeviceConfirmed)
                  }
                onClick={flasher.prepareBootloader}
              >
                {flasher.phase === "preparing" ? "Validating firmware…" : "Prepare keyboard"}
              </button>
            )}
            {bootloaderReady && !completed && <p className="instruction">The keyboard should now appear as a new Espressif serial device.</p>}
          </Step>

          <Step
            number="03"
            title="Flash and verify"
            state={completed ? "done" : ["selecting-port", "checking-bootloader", "flashing", "verifying-boot"].includes(flasher.phase) ? "active" : "idle"}
          >
            {!completed && (
              <>
                <p>
                  Choose the new bootloader port. The app checks chip, MAC, flash size, and security state before writing.
                  {flasher.selected.regions
                    ? " Every module page is verified and written before the app image at 0x10000."
                    : ""}
                </p>
                <button
                  className="button button--flash"
                  disabled={!bootloaderReady || busy}
                  onClick={flasher.flash}
                >
                  {flasher.phase === "selecting-port" ? "Waiting for Chrome…" :
                    flasher.phase === "checking-bootloader" ? "Checking bootloader…" :
                    flasher.phase === "flashing" ? `Flashing ${flasher.progress}%` :
                    flasher.phase === "verifying-boot" ? "Checking reboot…" :
                    `Flash ${flasher.selected.name}`}
                </button>
              </>
            )}

            {(["flashing", "verifying-boot", "complete"].includes(flasher.phase)) && (
              <div className="progress-block" aria-live="polite">
                <div className="progress-label">
                  <span>{flasher.phase === "complete" ? "Verified" : flasher.phase === "verifying-boot" ? "Rebooting" : flasher.selected.regions ? "Writing regions" : "Writing app"}</span>
                  <span>{flasher.progress}%</span>
                </div>
                <div className="progress-track"><span style={{ width: `${flasher.progress}%` }} /></div>
              </div>
            )}

            {completed && (
              <div className="success-block">
                <strong>{flasher.selected.name} is installed.</strong>
                <p>
                  Every written region matched its device MD5 and the Framer returned as a healthy USB device on firmware 0.4.1.
                  {flasher.selected.scenePackage
                    ? ` ${flasher.selected.scenePackage.actionLabel} is still required after every power cycle.`
                    : ""}
                </p>
                <div className="button-row">
                  {flasher.selected.hostCompanion && (
                    <a className="button button--secondary" href={flasher.selected.hostCompanion.url}
                      download={flasher.selected.hostCompanion.filename}>Download host companion</a>
                  )}
                  <DownloadReceipt receipt={flasher.receipt} />
                  <button className="button button--quiet" onClick={flasher.startOver}>Flash another build</button>
                </div>
              </div>
            )}
          </Step>

          {flasher.error && (
            <div className="error-box" role="alert">
              <strong>{identified ? "Flash stopped safely" : "Connection stopped safely"}</strong>
              <p>{flasher.error}</p>
              {flasher.canExitBootloader && (
                <button className="button button--secondary" onClick={flasher.exitBootloader}>
                  Exit bootloader without writing
                </button>
              )}
            </div>
          )}

          {flasher.logs.length > 0 && (
            <details className="log-panel" open={flasher.phase === "error"}>
              <summary>Device log <span>{flasher.logs.length} lines</span></summary>
              <pre>{flasher.logs.join("\n")}</pre>
            </details>
          )}
        </section> : <PreviewOnly firmware={flasher.selected} />}
      </main>

      <footer className="app-footer">
        <p>Runs entirely in this browser. No firmware or device data is uploaded.</p>
        <p>Unofficial local tool for exact Framer F1 0.4.1 research artifacts in this workspace.</p>
      </footer>
    </div>
  );
}
