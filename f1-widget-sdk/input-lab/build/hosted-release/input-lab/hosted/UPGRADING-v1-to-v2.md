# Upgrading the shared host from Input Lab v1 to v2

Companion to `deploy.md` (which is the from-scratch install). This is the
**in-place upgrade** for a host that already runs the v1 release under
`/opt/input-lab/current` with `input-lab-api.service` and the aaPanel static
site root. Nothing about the fixed production contract changes:

- public origin `https://htmlcss-to-framerf1-widget.g-m.dev`, loopback API
  `127.0.0.1:9231`, service user `input-lab`, Chrome pin, AppArmor profile and
  the Nginx rate-limits file are **unchanged**. The Nginx *site include* gains
  two proxied routes (`/api/render-v2/compile`, `/api/render-v2/simulate`) —
  see step 4.
- The server still never opens a USB device. Keyboard I/O stays in the
  user's browser (WebHID push / WebSerial flash).

## What v2 changes (why you are upgrading)

| Area | v1 | v2 |
|---|---|---|
| Physical weather delivery (mquickjs ID28) | only US ZIP `60601` (fixed "CHICAGO" label) | any 5-digit US ZIP; the redesigned widget has no place label |
| Weather widget look | text-only canary | cloud/sun icon, "Today", orange card, 3 forecast rows |
| ZIP editing | Input Lab field only | **on the keyboard** (settings mode) + Input Lab field; both read/write the same host config |
| ZIP persistence | none | `zip-sync-config.json` on the machine that owns the keyboard |
| Weather provider | deterministic fixture | Open-Meteo (`--provider open-meteo`) or the fixture |
| Hosted API | — | `GET/POST /api/zip-sync/config` exists but is **loopback-only**; in hosted mode it returns 404 by design (the shared host has no keyboard config) |

Firmware note: the ZIP settings mode needs the gen-20 mquickjs module + app on the
keyboard (flashed from the dev machine with the guarded workflow; the shared host
plays no part in flashing). Keyboards on older module builds still work with v2
Input Lab; they just don't have the settings mode.

## Where the ZIP round-trip actually runs

The keyboard→host→weather loop (`zip-sync.mjs`) polls the device over the Input
app's RPC transport, so it must run **on the computer the keyboard is plugged
into**, not on the shared host:

```bash
cd f1-widget-sdk
pgrep -fl run-live-media && echo "stop the media runner first (it hogs the RPC transport)"
node examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs --confirm-live-rpc --provider open-meteo
```

It persists to `f1-widget-sdk/build/zip-sync-config.json` (`--config PATH` to
override). The local (non-hosted) Input Lab dev bridge reads/writes that same
file, so the ZIP field and the keyboard stay in sync on that machine.

## Upgrade steps (shared host)

### 0. Build on the dev machine (already done for this release)

```bash
cd f1-widget-sdk
npm ci
npm run input-lab:test          # 95/95 expected
npm run input-lab:build-hosted  # → input-lab/build/input-lab-hosted-release.tgz
shasum -a 256 input-lab/build/input-lab-hosted-release.tgz
```

Upload the `.tgz` to `/opt/input-lab/incoming/input-lab-hosted-release.tgz`
(aaPanel Files or `scp`). Keep it outside `/www/wwwroot`.

### 1. Install as a new versioned release next to v1 (no downtime yet)

```bash
INPUT_LAB_RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
INPUT_LAB_RELEASE_DIR="/opt/input-lab/releases/$INPUT_LAB_RELEASE_ID"
sudo install -d -o root -g input-lab -m 0750 "$INPUT_LAB_RELEASE_DIR"
sudo tar -xzf /opt/input-lab/incoming/input-lab-hosted-release.tgz -C "$INPUT_LAB_RELEASE_DIR"
cd "$INPUT_LAB_RELEASE_DIR"
sudo npm ci --omit=dev
sudo chown -R root:input-lab "$INPUT_LAB_RELEASE_DIR"
sudo chmod -R o-rwx "$INPUT_LAB_RELEASE_DIR"
sudo find "$INPUT_LAB_RELEASE_DIR" -type d -exec chmod 0750 {} +
sudo find "$INPUT_LAB_RELEASE_DIR" -type f -exec chmod 0640 {} +
cat "$INPUT_LAB_RELEASE_DIR/RELEASE.json"   # sanity: same command/env contract as v1
```

`npm ci --omit=dev` must run on the Linux host (native `sharp`).

### 2. Confirm nothing in the environment contract moved

```bash
diff <(sed -n '/"env"/,/}/p' /opt/input-lab/current/RELEASE.json) \
     <(sed -n '/"env"/,/}/p' "$INPUT_LAB_RELEASE_DIR/RELEASE.json") && echo "env contract unchanged"
grep -F CHROME_PRODUCT /etc/input-lab/input-lab-api.env
```

If `INPUT_LAB_CHROME_PRODUCT` in the new `RELEASE.json`/`.env.example` differs
from what is installed, follow `deploy.md` §2–3 for the new Chrome pin before
switching. For this release the pin is unchanged, so skip that.

### 3. Switch the private release and restart the API

```bash
readlink -f /opt/input-lab/current            # note the v1 dir for rollback
sudo ln -sfn "$INPUT_LAB_RELEASE_DIR" /opt/input-lab/current
sudo systemctl restart input-lab-api.service
sudo systemctl --no-pager --full status input-lab-api.service
sudo journalctl -u input-lab-api.service -n 50 --no-pager
```

### 4. Publish the v2 static client

```bash
sudo tar -czf "/var/backups/input-lab/web-before-v2-$INPUT_LAB_RELEASE_ID.tgz" \
  -C /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev .
# aaPanel keeps an immutable .user.ini in the site root; exclude it or rsync/chown fail.
sudo rsync --archive --delete --exclude=.user.ini /opt/input-lab/current/public/ \
  /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev/
sudo find /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev -not -name .user.ini -exec chown www:www {} +
```

Nginx: **v2 adds two proxied routes** (`/api/render-v2/compile`, `/api/render-v2/simulate`);
a v1 host has only bridge/compile/capture/bundle and the v2 client gets 404 on compile.
Reinstall the release's site include (rate-limits file is unchanged), test, reload.
`/api/zip-sync/config` stays un-proxied on purpose.

```bash
I=/www/server/panel/vhost/nginx/extension/htmlcss-to-framerf1-widget.g-m.dev/input-lab-hosted.conf
sudo cp -a "$I" /var/backups/input-lab/input-lab-hosted.conf.v1
sudo install -o root -g root -m 0644 /opt/input-lab/current/input-lab/hosted/nginx-site.include.conf "$I"
sudo /www/server/nginx/sbin/nginx -t && sudo /www/server/nginx/sbin/nginx -s reload
```

### 5. Health checks

```bash
curl --fail --silent -H 'Host: htmlcss-to-framerf1-widget.g-m.dev' http://127.0.0.1:9231/api/bridge | \
  jq -e '.status == "ok" and .hosted == true and .devicePush == false and .zipSyncConfig == false'
curl --fail --silent https://htmlcss-to-framerf1-widget.g-m.dev/api/bridge | jq -e '.hosted == true'
test "$(curl --silent -o /dev/null -w '%{http_code}' https://htmlcss-to-framerf1-widget.g-m.dev/api/zip-sync/config)" = 404
# render-v2 routes must reach the app (403/422 from the app, never 404 from Nginx):
test "$(curl --silent -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://htmlcss-to-framerf1-widget.g-m.dev' -H 'Content-Type: application/json' -d '{}' https://htmlcss-to-framerf1-widget.g-m.dev/api/render-v2/compile)" != 404
test "$(curl --silent -o /dev/null -w '%{http_code}' https://htmlcss-to-framerf1-widget.g-m.dev/api/apply)" = 404
```

In a desktop Chrome/Edge: load the public origin, confirm `Compiler: ready`,
compile + Raster capture work, and in the mquickjs weather panel a ZIP other than
60601 (e.g. `63304`) is accepted for physical delivery.

## Rollback

```bash
sudo ln -sfn /opt/input-lab/releases/<previous-v1-id> /opt/input-lab/current
sudo systemctl restart input-lab-api.service
sudo tar -xzf "/var/backups/input-lab/web-before-v2-$INPUT_LAB_RELEASE_ID.tgz" \
  -C /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev
sudo chown -R www:www /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev
```

## Local machine (the one with the keyboard) — quick reference

- After every keyboard power cycle the v2 clock/timer content must be re-pushed
  (RAM-only by design until the persistent-scene work lands):
  `node examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs --confirm-live-rpc`
- Run `zip-sync.mjs` (above) for the keyboard ZIP editor to persist/refetch.
- Never run `npm run media:live` at the same time as pushes/zip-sync.
