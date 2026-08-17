# Input Lab hosted deployment (aaPanel, no Docker)

This pack deploys the compiler and Chromium capture service on the shared host while leaving keyboard I/O in the user's browser. WebHID performs scene Push and WebSerial performs the explicitly confirmed renderer flash. The server never opens a local USB device.

## Fixed production contract

- Public origin: `https://htmlcss-to-framerf1-widget.g-m.dev`
- aaPanel host: `https://172.239.194.8:28398/`
- Public site root: `/www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev`
- Private release link: `/opt/input-lab/current`
- Loopback API: `127.0.0.1:9231`
- aaPanel Nginx: `/www/server/nginx/sbin/nginx` (1.24.0 when inspected)
- Host: Ubuntu 24.04, x86_64, 1 vCPU, 1.92 GB RAM

The aaPanel sidebar **Node** screen at `/node/manage` manages server nodes; it is not a Node.js process manager. Use the systemd unit in this pack. If aaPanel's Website > Node Project runner is used instead, its start command must be exactly:

```text
node input-lab/server.mjs --hosted-origin https://htmlcss-to-framerf1-widget.g-m.dev --host 127.0.0.1 --port 9231 --max-concurrent-jobs 1
```

Set its project directory to `/opt/input-lab/current`, run user to `input-lab`, and environment file to `/etc/input-lab/input-lab-api.env`. Do not publish port 9231 or bind it to `0.0.0.0`.

## 1. Build and upload one release

From `f1-widget-sdk` on the development machine:

```bash
npm ci
npm run input-lab:build
node input-lab/tools/build-hosted-release.mjs
tar -tzf input-lab/build/input-lab-hosted-release.tgz | \
  rg '^(\./)?(RELEASE.json|package-lock.json|input-lab/server.mjs|input-lab/hosted/input-lab-chrome\.apparmor|public/index.html)$'
tar -tzf input-lab/build/input-lab-hosted-release.tgz | rg 'node_modules' && exit 1 || true
shasum -a 256 input-lab/build/input-lab-hosted-release.tgz
```

Upload `input-lab/build/input-lab-hosted-release.tgz` through aaPanel Files or SCP. Keep the archive outside the public site root, for example `/opt/input-lab/incoming/input-lab-hosted-release.tgz`.

On the server, create the unprivileged account and a versioned release. Replace the sample release ID with the build timestamp before running these commands:

```bash
sudo adduser --system --group --home /var/lib/input-lab-api --no-create-home input-lab
sudo install -d -o root -g input-lab -m 0750 /opt/input-lab /opt/input-lab/incoming /opt/input-lab/releases /opt/input-lab/runtime

INPUT_LAB_RELEASE_ID=20260816T213000Z
case "$INPUT_LAB_RELEASE_ID" in (*[!0-9TZ]*) echo "invalid release id" >&2; exit 1;; esac
INPUT_LAB_RELEASE_DIR="/opt/input-lab/releases/$INPUT_LAB_RELEASE_ID"
sudo install -d -o root -g input-lab -m 0750 "$INPUT_LAB_RELEASE_DIR"
sudo tar -xzf /opt/input-lab/incoming/input-lab-hosted-release.tgz -C "$INPUT_LAB_RELEASE_DIR"
cd "$INPUT_LAB_RELEASE_DIR"
sudo npm ci --omit=dev
sudo chown -R root:input-lab "$INPUT_LAB_RELEASE_DIR"
sudo chmod -R o-rwx "$INPUT_LAB_RELEASE_DIR"
sudo find "$INPUT_LAB_RELEASE_DIR" -type d -exec chmod 0750 {} +
sudo find "$INPUT_LAB_RELEASE_DIR" -type f -exec chmod 0640 {} +
sudo ln -sfn "$INPUT_LAB_RELEASE_DIR" /opt/input-lab/current
```

`npm ci --omit=dev` must run on the Linux host. The release archive intentionally excludes `node_modules`, so `sharp` installs its Linux x64 binary rather than a development-machine binary.

## 2. Install pinned headless Chrome

The raster service rejects any Chrome product other than the configured pin. For the current release, install Chrome for Testing 151.0.7922.138 at the path used by the environment template:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip libasound2t64 libatk-bridge2.0-0 libatk1.0-0 \
  libatspi2.0-0 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libgtk-3-0t64 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
  libxkbcommon0 libxrandr2 xdg-utils
sudo curl --fail --location --proto '=https' --tlsv1.2 \
  https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.138/linux64/chrome-linux64.zip \
  --output /opt/input-lab/incoming/chrome-linux64-151.0.7922.138.zip
sudo install -d -o root -g input-lab -m 0750 /opt/input-lab/runtime/chrome-151.0.7922.138
sudo unzip -q /opt/input-lab/incoming/chrome-linux64-151.0.7922.138.zip \
  -d /opt/input-lab/runtime/chrome-151.0.7922.138
sudo chown -R root:input-lab /opt/input-lab/runtime/chrome-151.0.7922.138
sudo chmod -R o-rwx /opt/input-lab/runtime/chrome-151.0.7922.138
sudo chmod 0750 /opt/input-lab/runtime/chrome-151.0.7922.138/chrome-linux64/chrome
/opt/input-lab/runtime/chrome-151.0.7922.138/chrome-linux64/chrome --version
```

The last command must report `Google Chrome for Testing 151.0.7922.138`. Do not add `--no-sandbox`; the service deliberately launches Chrome with its normal sandbox.

## 3. Install the path-scoped AppArmor exception

Ubuntu 24.04 restricts unprivileged user namespaces, which Chrome uses for its renderer sandbox. Install the release's AppArmor profile to allow `userns` only when the root-controlled, version-pinned Chrome executable is launched:

```bash
sudo install -d -o root -g root -m 0755 /etc/apparmor.d/local
sudo install -o root -g root -m 0644 \
  /opt/input-lab/current/input-lab/hosted/input-lab-chrome.apparmor \
  /etc/apparmor.d/input-lab-chrome
sudo apparmor_parser -Q -d /etc/apparmor.d/input-lab-chrome
sudo apparmor_parser -r /etc/apparmor.d/input-lab-chrome
sudo grep -F 'input-lab-chrome' /sys/kernel/security/apparmor/profiles
```

The last command must report `input-lab-chrome (unconfined)`. Keep every component of `/opt/input-lab/runtime/chrome-151.0.7922.138/chrome-linux64/chrome` root-owned and non-writable by the `input-lab` account. Do not widen the profile path with a wildcard, disable `kernel.apparmor_restrict_unprivileged_userns`, or apply this profile to the Node service.

This targeted exception is compatible with the service's `NoNewPrivileges=true`: Node remains AppArmor `unconfined`, and the exact Chrome executable attaches to the profile when spawned. The setting and Chrome's own sandbox must both remain enabled.

## 4. Install the environment and systemd service

Verify `node --version` is 22 or newer and `command -v node` is reachable through the unit's fixed `PATH`. Then install the templates:

```bash
node --version
sudo install -d -o root -g input-lab -m 0750 /etc/input-lab
sudo install -o root -g input-lab -m 0640 \
  /opt/input-lab/current/input-lab/hosted/input-lab-api.env.example \
  /etc/input-lab/input-lab-api.env
sudo install -o root -g root -m 0644 \
  /opt/input-lab/current/input-lab/hosted/input-lab-api.service \
  /etc/systemd/system/input-lab-api.service
sudo systemd-analyze verify /etc/systemd/system/input-lab-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now input-lab-api.service
INPUT_LAB_SERVICE_PID="$(systemctl show -p MainPID --value input-lab-api.service)"
sudo cat "/proc/$INPUT_LAB_SERVICE_PID/attr/current"
sudo grep '^NoNewPrivs:' "/proc/$INPUT_LAB_SERVICE_PID/status"
```

The final two commands must report `unconfined` and `NoNewPrivs: 1`. Stop if the service has another AppArmor label: a confined parent changes the `NoNewPrivileges` transition rules.

If the release archive stores deployment templates separately, upload these two files from this directory to the same destinations. The production environment has four values:

- `NODE_ENV=production`
- `INPUT_LAB_HOSTED_CACHE_ONLY=1` prevents a Linux host from falling back to the macOS-only glyph generator; unsupported glyphs take the bounded Raster/Auto path.
- `INPUT_LAB_CHROME_PATH` is the absolute pinned browser executable.
- `INPUT_LAB_CHROME_PRODUCT=Chrome/151.0.7922.138` is checked through CDP on every capture.

The `--max-concurrent-jobs 1` flag is also enforced in the Node process. A second overlapping compile/capture/bundle request receives HTTP 429 instead of creating another Chromium workload.

## 5. Publish the static client

Back up the exact aaPanel root, then replace it with the release's `public/` directory:

```bash
sudo install -d -o root -g root -m 0750 /var/backups/input-lab
sudo tar -czf /var/backups/input-lab/web-before-hosted-api.tgz \
  -C /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev .
sudo rsync --archive --delete /opt/input-lab/current/public/ \
  /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev/
sudo chown -R www:www /www/wwwroot/htmlcss-to-framerf1-widget.g-m.dev
```

The private release must remain under `/opt/input-lab`; never place `server.mjs`, `RELEASE.json`, the glyph cache, or `node_modules` under `/www/wwwroot`.

## 6. Install Nginx policy and same-origin API proxy

First confirm aaPanel includes `/www/server/panel/vhost/nginx/*.conf` from the `http {}` context and includes the site's extension directory from its `server {}` block:

```bash
sudo /www/server/nginx/sbin/nginx -T 2>&1 | \
  grep -E 'vhost/nginx/\*\.conf|extension/htmlcss-to-framerf1-widget\.g-m\.dev'
```

Install the two templates:

```bash
sudo install -o root -g root -m 0644 \
  /opt/input-lab/current/input-lab/hosted/nginx-http-rate-limits.conf \
  /www/server/panel/vhost/nginx/00-input-lab-rate-limits.conf
sudo install -d -o root -g root -m 0755 \
  /www/server/panel/vhost/nginx/extension/htmlcss-to-framerf1-widget.g-m.dev
sudo install -o root -g root -m 0644 \
  /opt/input-lab/current/input-lab/hosted/nginx-site.include.conf \
  /www/server/panel/vhost/nginx/extension/htmlcss-to-framerf1-widget.g-m.dev/input-lab-hosted.conf
sudo /www/server/nginx/sbin/nginx -t
sudo /www/server/nginx/sbin/nginx -s reload
```

Do not create an aaPanel reverse proxy for `/`; the static app stays in the existing site root. Only the four exact API routes are proxied. `/api/apply` and every unknown `/api/*` path fail closed at Nginx. No CORS configuration is needed because the client uses its own HTTPS origin.

The site template also supplies CSP, `Permissions-Policy: hid=(self), serial=(self)`, clickjacking/referrer/MIME protections, and same-origin opener/resource policies. The existing aaPanel SSL vhost already supplies HSTS.

## 7. Health and security checks

There is intentionally no separate unauthenticated health route. `/api/bridge` is the health probe and validates the hosted capability contract.

```bash
sudo systemctl --no-pager --full status input-lab-api.service
sudo journalctl -u input-lab-api.service -n 100 --no-pager

curl --fail --silent --show-error \
  -H 'Host: htmlcss-to-framerf1-widget.g-m.dev' \
  http://127.0.0.1:9231/api/bridge | \
  jq -e '.status == "ok" and .hosted == true and .localOnly == false and
    .devicePush == false and .deviceTransport == "browser-webhid"'

curl --fail --silent --show-error \
  https://htmlcss-to-framerf1-widget.g-m.dev/api/bridge | \
  jq -e '.status == "ok" and .hosted == true and .devicePush == false'

curl --silent --head https://htmlcss-to-framerf1-widget.g-m.dev/ | \
  grep -Ei 'content-security-policy|permissions-policy|strict-transport-security|x-content-type-options'

test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  https://htmlcss-to-framerf1-widget.g-m.dev/api/apply)" = 404

sudo journalctl -k --since '-5 min' | \
  grep -E 'apparmor="DENIED".*(userns_create|input-lab-chrome|chrome)' && exit 1 || true
```

In desktop Chrome or Edge, load the public origin and confirm:

1. `Compiler: ready` appears without a localhost companion.
2. Compile and Raster capture work.
3. Connect keyboard opens a browser WebHID chooser.
4. Apply/Push uses WebHID from the page; the server reports no device transport.
5. Flash renderer opens the explicit WebSerial flow only after the in-page confirmation.

## Rollback

Point `/opt/input-lab/current` back to the prior versioned release and restart `input-lab-api.service`. Restore the static backup into the exact public root. To return to static-only mode, disable the service, remove the two Input Lab Nginx include files, run `nginx -t`, and reload Nginx. Keep versioned releases and the web backup until the public browser checks pass.
