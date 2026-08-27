# 19 — Publishing the Widget Designer (widget-designer.g-m.dev)

The Widget Designer is a **static** site: HTML, CSS, JS and pinned firmware
binaries. Nothing runs server-side. Every privileged thing happens in the
user's own browser — WebHID talks to the keyboard, Web Serial writes firmware —
so the host only ever serves files. That is why this deployment is a file copy
and an Nginx vhost, not a service like `input-lab` (docs: `f1-widget-sdk/
input-lab/hosted/deploy.md`, which needs Node and Chromium and is the harder
pattern; do not copy it here).

## Fixed production contract

- Public origin: `https://widget-designer.g-m.dev`
- Site root: `/www/wwwroot/widget-designer.g-m.dev`
- Host: the same aaPanel box as the Input Lab (`172.239.194.8`, Ubuntu 24.04)
- Panel: `https://172.239.194.8:28398/` (its entrance path is a secret)
- No open ports, no daemon, no database.

### The site layout is part of the contract

```text
/                 the Widget Designer
/flasher/         the web flasher (firmware installer)
```

The Designer links to `./flasher/` from the callouts a user hits when their
keyboard cannot receive widgets (`DevicePanel.tsx`, `FLASHER_URL`). A widget
CANNOT reach a keyboard that is not running the Widget Designer firmware, so
that link is load-bearing: publishing the Designer without the flasher beneath
it strands every new user whose keyboard still has stock firmware.

To host the flasher somewhere else instead, set a global before the bundle
loads — no rebuild required:

```html
<script>window.__WD_FLASHER_URL__ = "https://elsewhere.example/flasher/";</script>
```

## 1. Build the release (development machine)

```bash
cd web-flasher/widget-designer && npm ci && npx vitest run && npm run build
cd .. && npm ci && npm run build
```

Both builds must be present: `widget-designer/dist` (the Designer) and
`web-flasher/dist` (the flasher). Assemble the exact tree the host will serve:

```bash
REL=/tmp/widget-designer-release
rm -rf "$REL" && mkdir -p "$REL/flasher"
cp -R web-flasher/widget-designer/dist/* "$REL/"
cp -R web-flasher/dist/* "$REL/flasher/"
tar -czf /tmp/widget-designer-site.tgz -C "$REL" .
shasum -a 256 /tmp/widget-designer-site.tgz
```

Verify the archive BEFORE uploading — a broken bundle is far cheaper to catch
here than on the public origin:

```bash
cd "$REL" && python3 -m http.server 8899 &
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/          # 200
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/flasher/  # 200
```

Then open `http://127.0.0.1:8899/` and confirm the first-run strip appears,
the tabs read Design / Source / Send / Device, and the example gallery lists
six widgets.

## 2. Publish

DNS first: `widget-designer.g-m.dev` must have an A record pointing at
`172.239.194.8` (the Input Lab domain on the same box is the model). Until it
resolves, Let's Encrypt cannot issue and the vhost cannot answer.

Then, in aaPanel: **Website → Add site** for `widget-designer.g-m.dev` with
root `/www/wwwroot/widget-designer.g-m.dev`, no FTP, no database, no Node
project. Upload `widget-designer-site.tgz` through **Files** into that root
and extract it there, then delete the archive from the public root.

Over SSH the same thing is:

```bash
scp /tmp/widget-designer-site.tgz gavin@172.239.194.8:/tmp/
ssh gavin@172.239.194.8 '
  sudo install -d -o www -g www /www/wwwroot/widget-designer.g-m.dev &&
  sudo tar -xzf /tmp/widget-designer-site.tgz -C /www/wwwroot/widget-designer.g-m.dev &&
  sudo chown -R www:www /www/wwwroot/widget-designer.g-m.dev &&
  rm -f /tmp/widget-designer-site.tgz'
```

Finally issue the certificate (aaPanel → SSL → Let's Encrypt) and turn on
**Force HTTPS**. This is not cosmetic: **WebHID and Web Serial only exist in a
secure context**, so over plain HTTP the Designer loads but can never reach a
keyboard.

## 3. Nginx notes

The defaults aaPanel writes are almost right. Two additions matter:

```nginx
# Hashed assets are immutable; the entry documents must never be cached, or a
# republish leaves people on the old app until they hard-reload.
location ~* \.(js|css|woff2?|png|svg|bin)$ { expires 30d; add_header Cache-Control "public, immutable"; }
location = /index.html         { add_header Cache-Control "no-store"; }
location = /flasher/index.html { add_header Cache-Control "no-store"; }
```

No SPA rewrite is wanted. The Designer keeps its state in the query string
(`?tab=…`), so `try_files $uri $uri/ =404` is correct, and a 404 for a real
typo is more honest than silently serving the app.

## 4. Verify the published origin

```bash
curl -sf -o /dev/null -w 'designer %{http_code}\n' https://widget-designer.g-m.dev/
curl -sf -o /dev/null -w 'flasher  %{http_code}\n' https://widget-designer.g-m.dev/flasher/
curl -sI https://widget-designer.g-m.dev/ | rg -i 'strict-transport|cache-control'
```

Then in a browser, on a machine with an F1 plugged in:

1. The first-run strip appears and the gallery lists six examples.
2. **Device → Connect** shows the WebHID chooser (this is the secure-context
   proof; if the chooser never appears, HTTPS is not actually enforced).
3. Build a widget and send it to the keyboard.
4. Follow the flasher link from a Device-tab callout and confirm
   `/flasher/` loads its card catalog.

## Updating later

Rebuild, re-verify locally, re-extract over the same root. The asset filenames
are content-hashed, so a stale `index.html` is the only way a user can be left
on an old build — which is exactly what the `no-store` rule above prevents.
