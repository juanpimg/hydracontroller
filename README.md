# 📱 Hydra Controller — Linux Mobile Deck

[![LAN-Only](https://img.shields.io/badge/Network-LAN%20Only-orange)](#-security)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collected-blue)](#-security)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

> **Turn your smartphone or tablet into a dedicated touch screen for your Linux PC, without duplicating or disturbing your main display.**

🌐 **Project website:** deployed with Cloudflare Pages from [`landing/`](./landing/) — open it, customize it, and publish it with your changes.

---

## ⚡ What it does

- **Isolated virtual sessions**: each app launches on its own virtual display with headless `gamescope`, sized to your phone's resolution (always even numbers). Your main desktop stays untouched.
- **Real-time streaming**: PipeWire capture (`pipewiresrc`) and JPEG over binary WebSocket, with congestion control. No cloud involved.
- **Real touch**: multitouch (up to 10 fingers), native mobile keyboard, and floating buttons (back, keyboard, fullscreen, close).
- **PWA launcher**: catalog of your `.desktop` apps with icons, search, categories, and favorites; task switcher to jump between sessions.
- **QR pairing**: self-signed TLS generated on your machine + QR code in the terminal. Same Wi-Fi and you're in.
- **Tests that bite**: unit tests (Vitest), e2e with gray/black-frame detection, and a stress suite.

> Honest project status: video today is **MJPEG over WebSocket** (no WebRTC/H.264 yet) and input goes mostly over **X11/xdotool** (apps are forced to X11). There is a [list of ideas to contribute](#-contributing) if you want to take it further.

---

## 🧰 Requirements

- **Linux** with Node.js 20+, `npm`, `gcc`/`make`, `ffmpeg`, `gamescope`, `gstreamer` (base plugins + `avenc_mjpeg` via libav), `xdotool`, `pw-dump`/`pw-link` (PipeWire), and a terminal emulator (e.g. `alacritty` for console apps).

```bash
# Arch / CachyOS
sudo pacman -S gcc make ffmpeg gamescope nodejs npm gstreamer gst-libav xdotool pipewire alacritty

# Ubuntu / Debian (indicative names)
sudo apt install gcc make ffmpeg gamescope nodejs npm gstreamer1.0-libav xdotool pipewire alacritty

# Fedora (indicative names)
sudo dnf install gcc make ffmpeg gamescope nodejs npm gstreamer1-libav xdotool pipewire alacritty
```

> **`/dev/uinput` permissions** (only if you want the experimental host touch bridge):
> ```bash
> sudo usermod -aG input $USER  # then log back in
> ```

---

## 🚀 Install & run

Inside `apps/hydra-controller`:

```bash
npm install          # dependencies
npm run build        # uinput bridge (gcc) + web UI (tsc + vite)
npm start            # HTTPS server on :4096 + QR code in the terminal
```

### Connect your phone

1. Phone and PC on the **same Wi-Fi**.
2. Scan the terminal QR code (or open `https://<PC-IP>:4096` / `https://hydra.local:4096`).
3. Accept the self-signed certificate (generated into `.certs/`, never committed to git).
4. Optional: “Add to Home Screen” for fullscreen standalone mode.
5. Tap any app: it opens maximized to your screen size and touches land 1:1.

### Local development

```bash
npm run dev:all     # vite on :5173 (proxied /api and /ws) + backend on :4096
```

Open `http://127.0.0.1:5173`: the `vite.config.ts` proxy forwards the API and the WebSocket to the real backend, so you can test the full flow from your PC.

---

## 🧪 Tests

```bash
npm test             # unit tests (Vitest): scanner, certs, uinput, gray/black screen, touch, fit
npm run test:e2e     # real streaming + content check (fails with GRAY_FRAME on gray frames)
npm run test:stress  # concurrency, backpressure, and session cleanup
```

---

## 📂 Structure

```
apps/hydra-controller/
├── landing/                  # Project static website (Cloudflare Pages: no build, landing/ folder)
├── server/
│   ├── index.ts              # Express + HTTPS + WebSocket /ws, REST sessions, binary input
│   ├── virtual-display.ts    # Headless gamescope, Xwayland/PipeWire parsing, window fit, xdotool input
│   ├── streamer.ts           # GStreamer pipewiresrc → MJPEG → JPEG frames over WS
│   ├── app-scanner.ts        # .desktop apps + icons
│   ├── certs.ts / qr.ts      # Self-signed local TLS + pairing QR
│   └── uinput-bridge.ts + uinput/hydra-uinput.c  # /dev/uinput bridge (experimental, unforwarded)
├── src/
│   ├── App.tsx               # Launcher vs streaming, sessions, favorites
│   ├── components/           # StatusBar, AppGrid, StreamView (canvas), RunningTasks
│   ├── hooks/useHydraSocket.ts  # WS, ping/latency, queued attach, video chunks
│   └── lib/frame-guard.ts    # Broken/gray frame filtering
└── tests/                    # Vitest + e2e (mjs) + stress
```

---

## 🩺 Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Black screen on launch | PipeWire node is slow or content is static | Wait a few seconds: the server retries the link and nudges a redraw on attach |
| All gray | The app draws nothing (broken `Exec`, terminal with no emulator) | Check the `[hydra-display]` log; console apps are wrapped with `alacritty -e` |
| Taps land elsewhere | Window not maximized yet (slow apps) | The server maximizes it on its own (polls up to 120s); if it persists, check `xdotool search` on `:N` |
| Taps hit your real desktop | Legacy uinput forwarding | Update: since `ea6d50a` session input no longer goes to the host |
| Certificate rejected | Self-signed | Accept the exception once; verify IP and fingerprint; renew by deleting `.certs/` |
| `vite` dev with no apps/WS | No backend running | Also start the backend (`npm run dev:all`) or use `npm start` |

More technical detail in [`GEMINI.md`](./GEMINI.md).

---

## 🤝 Contributing

We'd love your help! Open areas with room made for them:

- **Full keyboard**: letters A–Z are still missing from the `sendKeyEvent` map.
- **H.264/WebRTC video** versus today's MJPEG, with latency measurements.
- **Native Wayland input** beyond the current X11 bridge.
- **Tests on real hardware**, guides, and translations (ideal first contribution).

Steps: fork → branch (`fix/…`, `feat/…`) → PR telling us what you tested on real hardware. Issues and code at <https://github.com/juanpimg/hydracontroller>.

The landing page welcomes improvements too: edit [`landing/`](./landing/) and preview it with any static server:

```bash
cd landing && python3 -m http.server 8080  # http://127.0.0.1:8080
```

### Deploy the landing on Cloudflare Pages

1. Push the repo to GitHub (already at <https://github.com/juanpimg/hydracontroller>).
2. In the Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: *(empty)* · Output directory: `landing`.
4. Deploy: every push to `main` republishes automatically.

---

## 🔒 Security

Local network (LAN) only: never expose it to the Internet. Self-signed TLS in `.certs/`, secrets ignored (`.env*`, `*.pem`, `*.key`). No accounts, no cloud.

---

## ⚖️ Legal notice

Use only on your own or trusted machines and networks: it needs sensitive permissions (`input` group, `/dev/uinput`), runs apps on your machine, and exposes HTTPS on your LAN. Verify the address and certificate fingerprint. Software “as is” under the MIT license, no warranties.
