# Hydra Controller — Improvement Roadmap

Synthesized from a 5-expert code review (frontend, streaming, input, testing, security).
Ordered by impact/effort. Checkboxes track execution — tick them in PRs.

## Phase 0 — Immediate hygiene (S, hours)

- [ ] **CI gate** (`.github/workflows/ci.yml`): `npm ci` → `tsc` on `src/` **and** `server/` (fix `tsconfig.json` `include`) → `build:uinput` (gcc) → `build:ui` → `vitest run`. Block on all four.
- [ ] **LAN auth token**: random token at boot (persist in `.certs/`), required on REST+WS, embedded in QR URL (`server/index.ts`, `server/qr.ts`). Plus `express.json({ limit })`.
- [ ] **RCE via `.desktop` Exec**: stop `sh -c` on raw strings — parse `Exec` to argv per freedesktop spec, reject `;|&|$` backticks `$()` `<>`, skip+log in `scanLinuxApps()` (`server/app-scanner.ts`, `server/virtual-display.ts`).
- [ ] **Session/input limits**: `MAX_SESSIONS=3–5`, clamp `width/height 320–1920, fps 5–60`, validate WS packet ranges, throttle `move` ≤60Hz (`server/index.ts`, `server/virtual-display.ts`).
- [ ] **Stop dead weight**: don't spawn `hydra-uinput` when unforwarded (flag it), remove `audioToClient` placebo leftovers, unify `theme-color` meta vs manifest.

## Phase 1 — Robustness (S/M, days)

- [ ] **Auto-reconnect**: exponential backoff + `online`/`visibilitychange` + idempotent re-`attach` with `Conectando…` state (`src/hooks/useHydraSocket.ts`, `src/components/StreamView.tsx`).
- [ ] **Stream watchdog**: if 0 frames/bytes in 4s → relink once → restart with backoff + `link/no-frames` status in logs and `GET /api/sessions/:id/stats` (`server/streamer.ts`).
- [ ] **Process registry**: track `gamescope`/`gst`/`pw-*`/`xdotool` children, kill by tree, reaper on boot, clear `fitPolls` in `terminateAll()`, async `execFile` instead of `execFileSync` in hot paths.
- [ ] **TLS hygiene**: print SHA-256 fingerprint in banner for TOFU check, `chmod 600 key.pem` (`server/certs.ts`, `server/qr.ts`).
- [ ] **Icon path confinement + no `exec` leak**: only serve icons under `ICON_DIRS` with image extensions; stop sending `exec` to the frontend (`server/app-scanner.ts`, `server/index.ts`).

## Phase 2 — Input that feels native (S/M)

- [ ] **Real keyboard**: Shift/caps via `keydown/keyup` symmetry + `e.getModifierState()`, `e.repeat` support, complete table (`F1–F12`, `Delete`, `Home/End`, `Super`), ES layout (`ñ`, `¿`, dead keys) via `e.code`/Unicode (`src/lib/keymap.ts`, `src/components/StreamView.tsx`, `server/virtual-display.ts`).
- [ ] **Cheap pointer path**: coalesce moves (`getCoalescedEvents` + rAF throttle ~60Hz), drop when `bufferedAmount` high, single-flight `mousemove` server-side; then persistent XTEST daemon instead of `spawn`-per-event.
- [ ] **Gestures**: wheel → scroll buttons 4/5, 2-finger vertical → scroll, long-press → right click, Ctrl+wheel → zoom.

## Phase 3 — Video quality (M/L)

- [ ] **Observability first**: `frames, bytes, drops, linkOkAt` per streamer + client `decodedFps/decodeMs` (`GET /api/sessions/:id/stats`). You can't tune what you can't see.
- [ ] **Adaptive quality**: dynamic `quantizer`/`fps` from `bufferedAmount`+RTT; fix `fps` inconsistency (60 vs 30 defaults); raise WS congest threshold with bigger frames.
- [ ] **H.264 path**: `x264enc tune=zerolatency` (or VAAPI/openh264) + MSE playback; WebRTC/WHIP as the long bet.

## Phase 4 — Frontend polish (M)

- [ ] **Sharp canvas**: DPR-aware sizing (`min(dpr,2)`), cached context, latest-wins + `requestAnimationFrame` instead of drop-if-busy.
- [ ] **Touch correctness**: `setPointerCapture`, discard letterboxed touches instead of clamping, pointer-cancel cleanup.
- [ ] **Installable PWA + a11y**: PNG 192/512 + maskable icons, `VitePWA` offline, real `<button>`s ≥44px, `safe-area` insets, `inputMode`/`enterKeyHint`.
- [ ] **i18n**: ES/EN switch (app UI is Spanish-only today).

## Phase 5 — Architecture (L, when Phases 0–2 hurt)

- [ ] Split `server/index.ts` (routes, ws-protocol, session-store).
- [ ] `SafeExec { argv[] }` type end-to-end instead of `string exec`.
- [ ] Versioned, validated `protocol.ts` for WS binary packets.
- [ ] Native Wayland input via `libei`/portal instead of X11+XTEST.

---
*Sources: frontend, streaming, input, testing, and security expert reviews (Oct 2026 session). Security items R1–R5 and test gaps R1–R5 are folded into the phases above.*
