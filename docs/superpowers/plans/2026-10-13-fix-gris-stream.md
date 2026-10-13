# Gray Screen Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar pantalla gris en móvil: que al abrir una app se vea contenido real, no fondo gris del compositor.

**Architecture:** Fijar la cadena gamescope headless → PipeWire (pw-link explícito) → GStreamer (caps explícitas + queue leaky + fallback software) → WS binario (seq + size guard) → canvas (createImageBitmap fast-path + fallback Image, drop-if-busy, sonda gris). Cada capa con test que distingue gris de contenido.

**Tech Stack:** TypeScript, Node (tsx), GStreamer (pipewiresrc, videoconvert, videoscale, avenc_mjpeg), gamescope, pw-dump/pw-link, React 18 + Vite, vitest.

**Spec:** Investigación previa en conversación (sesiones ses_ec906d722ffeLJ7PsnyifV2wK6 gris-local + 3 agentes OSS gamescope/streaming/input). Sin doc externa; los valores exactos van en cada tarea.

## Global Constraints

- No romper `npm test` (vitest) ni `npm run build:ui` (tsc + vite build).
- GStreamer disponible: `avenc_mjpeg` sí, `jpegenc` NO (verificado con gst-inspect). No usar `jpegenc`.
- Licencias seguras para copiar: MIT / Apache-2.0 / BSD / ISC. NO copiar código GPL/AGPL (Sunshine, Janus, RustDesk, ydotool, dotool) — solo ideas.
- Dimensiones siempre pares: `Math.ceil(n/2)*2` en frontend y backend.
- Un cambio por tarea, estilo TDD: test que falla primero.

## Review Focus

- Frame gris válido (media ~128, varianza ~0) pasa como "video OK" — cada tarea debe probar varianza, no solo media/bytes.
- PipeWire node-id reciclado apunta a sesión vieja tras hotplug/resume — preferir serial/target-object cuando exista, si no validar node.id por sesión.
- Safari iOS entrega Blob aunque binaryType sea arraybuffer — el cliente debe aceptar ambos y descartar <800 bytes.
- gamescope sin superficie Xwayland compone fondo gris — el backend debe no publicar stream como listo hasta haber app real.
- Backpressure móvil lenta (bufferedAmount>256KB) congela como gris — dropear por frame/cliente sin matar stream.

---

### Task 1: Streamer anti-gris (caps + link correcto + fallback real)

**Files:**
- Modify: `server/streamer.ts:138-156` (gstArgs), `server/streamer.ts:189-199` (bucle outPort), `server/streamer.ts:278-284` (stderr filter)
- Test: `tests/gray-screen.test.ts`

**Interfaces:**
- Consumes: `StreamerOptions { displayNum, width, height, fps?, pipewireNodeId? }`
- Produces: `AppStreamer.getClientCount(), updateDisplayNum(n), updatePipewireNodeId(n), addClient(ws), removeClient(ws)` (sin cambios de firma); nuevo método público `getEncoderArgs(): string[]` para testear fallback sin spawnear gst.

- [ ] **Step 1: Write the failing test** en `tests/gray-screen.test.ts`: `getEncoderArgs()` devuelve `['vajpegenc',...]` por defecto y `['avenc_mjpeg',...]` tras 2 fallos; pipeline incluye `videoconvert ! videoscale ! queue leaky` y caps `format=BGRx,width,height,framerate`; bucle pw-dump hace break tras primer outPort válido (testea helper puro `pickPorts(dump, nodeId, clientName)`).
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/gray-screen.test.ts` Expected: FAIL "getEncoderArgs is not a function".
- [ ] **Step 3: Implement `getEncoderArgs()` + `pickPorts()` puros en `server/streamer.ts`** y úsalos en `startProcess()`; gstArgs = `pipewiresrc target-object?/autoconnect=false … ! video/x-raw,format=BGRx,width=EW,height=EH,framerate=30/1 ! queue max-size-buffers=3 leaky=downstream ! videoconvert ! videoscale ! <encoder> ! fdsink`; `break` tras primer outPort output válido; no pintar buffer size==0 (seguir en PREROLL).
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/gray-screen.test.ts tests/black-screen.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/streamer.ts tests/gray-screen.test.ts && git commit -m "fix(streamer): caps explícitas + link correcto + fallback avenc_mjpeg"`

### Task 2: Virtual-display app real (no fondo gris)

**Files:**
- Modify: `server/virtual-display.ts:75-98` (parseo stderr/stdout, foco inicial)
- Test: `tests/gray-screen.test.ts` (añadir bloque)

**Interfaces:**
- Consumes: `launchApp(appId, appName, execCmd, width, height): RunningSession`
- Produces: `RunningSession { displayNum: 0 hasta ready, isReady, pipewireNodeId? }`; nuevo `isAppAlive(sessionId): boolean` (proc.exitCode===null && !killed).

- [ ] **Step 1: Write the failing test** — `launchApp('x','t','sleep 30',390,844)` devuelve `width 390→390 (ya par), 393→394`; `displayNum===0, isReady===false`; `isAppAlive(id)===true`; tras `terminateSession` es false. Escucha también `proc.stdout` (no solo stderr) para `Starting Xwayland`.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/gray-screen.test.ts -t "isAppAlive"` Expected: FAIL.
- [ ] **Step 3: Implement** en `server/virtual-display.ts`: redondeo ya existe, añadir escucha `proc.stdout` con mismo regex, `isAppAlive()`, y tras `display-ready` hacer `windowactivate + mousemove centro + click 1` vía `DISPLAY=:N xdotool` (best-effort, sin bloquear). Validar `execCmd` no vacío antes de spawn.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/gray-screen.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/virtual-display.ts tests/gray-screen.test.ts && git commit -m "fix(display): app real antes de publicar stream"`

### Task 3: Frontend canvas anti-gris (size guard + drop-if-busy + sonda)

**Files:**
- Modify: `src/components/StreamView.tsx:62-98` (draw path), `src/hooks/useHydraSocket.ts:46-69` (onmessage)
- Test: `tests/gray-screen.test.ts` (helpers puros `shouldDropFrame(size)`, `grayStats()`)

**Interfaces:**
- Consumes: `setOnVideoChunk(cb)`, WS `message.data: ArrayBuffer | Blob | string`
- Produces: `shouldDropFrame(sizeBytes: number): boolean` (true si <800), `isGrayFrame(mean, vari: number): boolean` (vari<90 && 40<mean<215), `drawBlob()` con fast-path createImageBitmap + fallback Image + revokeObjectURL.

- [ ] **Step 1: Write the failing test** — `shouldDropFrame(100)===true, shouldDropFrame(5000)===false`; `isGrayFrame(128,2)===true, isGrayFrame(15,45)===false`. Importados desde `src/lib/frame-guard.ts` (nuevo, sin DOM).
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/gray-screen.test.ts -t "frame guard"` Expected: FAIL "Cannot find module".
- [ ] **Step 3: Implement `src/lib/frame-guard.ts`** con esas 2 funciones puras; úsalas en `StreamView.tsx` (descarta chunk<800 antes de Blob, `decoding` flag drop-if-busy) y en `useHydraSocket.ts` (acepta Blob y ArrayBuffer, convierte a Uint8Array).
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run tests/gray-screen.test.ts` Expected: PASS + `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit** — `git add src/lib/frame-guard.ts src/components/StreamView.tsx src/hooks/useHydraSocket.ts tests/gray-screen.test.ts && git commit -m "fix(frontend): drop frames rotos + sonda gris"`

### Task 4: E2E gris→contenido (media + varianza)

**Files:**
- Modify: `tests/e2e-stream.mjs:93-137`, `tests/stress-review.mjs` (umbral, sin cambiar lógica de stress)
- Test: el propio e2e es el test.

**Interfaces:**
- Consumes: servidor en `:4096`, `POST /api/sessions/launch`, `WSS /ws attach_stream`, `ffmpeg -pix_fmt gray pipe:1`
- Produces: veredicto `GRIS` vs `CONTENIDO` (media + stddev + p95-p5).

- [ ] **Step 1: Write the failing check** — en `e2e-stream.mjs` calcula `mean, stddev`; exige `stddev>12` además de `mean>1.0`; mensaje `GRAY_FRAME` si `vari<90 && 40<mean<215`.
- [ ] **Step 2: Run to verify it fails on gray** — Run: `node tests/e2e-stream.mjs` contra build actual con app vacía Expected: FAIL `GRAY_FRAME` (prueba que el test caza gris).
- [ ] **Step 3: Implement** solo el check (no tocar servidor aquí); documenta comando manual `/tmp/probe.mjpeg + ffprobe` en `GEMINI.md`.
- [ ] **Step 4: Run to verify it passes with real app** — Run: `node tests/e2e-stream.mjs` con `xterm` visible Expected: PASS.
- [ ] **Step 5: Commit** — `git add tests/e2e-stream.mjs GEMINI.md && git commit -m "test(e2e): detecta frame gris por varianza"`

### Task 5: Verificación navegador (móvil o desktop)

**Files:**
- Modify: ninguno (solo verificación). Usa `dist/` ya construido.
- Test: checklist manual + `npm run build:ui`.

**Interfaces:**
- Consumes: `npm run build:ui`, `npm start` (:4096), móvil misma WiFi + cert aceptado o desktop `https://127.0.0.1:4096`.
- Produces: evidencia (screenshot + log `Successfully linked` + frame guardado con contenido).

- [ ] **Step 1: Build fresco** — Run: `npm run build:ui` Expected: exit 0, `dist/assets/*.js`.
- [ ] **Step 2: Arranca + abre app visible** — Run: `npm start`, abre `xterm`, adjunta StreamView. Expected: overlay `Iniciando…` desaparece <5s, canvas con terminal (no gris).
- [ ] **Step 3: Guarda frame real** — guarda 1 chunk WS a `/tmp/ws-frame.jpg`, ábrelo en visor + `ffmpeg … | python media+stddev`. Expected: `stddev>12`.
- [ ] **Step 4: Full suite** — Run: `npx vitest run` Expected: 0 failures.
- [ ] **Step 5: Commit final si todo verde** — si algo falla, volver a Task 1-3, no forzar.
