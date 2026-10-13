# Task 1 Report: Streamer anti-gris

- Date: 2026-10-13
- Files: `server/streamer.ts` (modified), `tests/gray-screen.test.ts` (new)
- Commit: `50000c3 fix(streamer): caps explícitas + link correcto + fallback avenc_mjpeg`

## TDD evidence
- Before: `npx vitest run tests/gray-screen.test.ts` → 4 failed, `TypeError: s.getEncoderArgs is not a function` (+ `pickPorts is not a function`, pipeline sin `videoscale`).
- After: `npx vitest run tests/gray-screen.test.ts tests/black-screen.test.ts` → 2 files, 7 tests PASS.
- Full suite: `npx vitest run` → 5 files, 11 tests PASS. `npx tsc --noEmit` limpio.

## What was implemented (brief §Task 1, Step 3)
- `pickPorts(dump, nodeId, clientName)` puro exportado: dos pasadas con `break` tras primer outPort válido (`node.id === nodeId`) y primer inPort del cliente (`node.name === clientName || port.alias startsWith clientName`); usado en `startProcess()` en vez del bucle que sobrescribía con el último puerto.
- `getEncoderArgs(): string[]` público: `['vajpegenc','quality=85']` por defecto, `['avenc_mjpeg','quality=85']` tras 2 fallos; usado en `startProcess()`.
- `recordFailure()` privado: cuenta fallos y conmuta a software tras ≥2 (limpia `pipewireNodeId`); `on error` / `on exit(code!==0)` delegan en él (antes lógica duplicada inline).
- `gstArgs`: `pipewiresrc [target-object=N si hay nodeId] autoconnect=false client-name keepalive-time ! video/x-raw,format=BGRx,width=EW,height=EH,framerate=MAX(30,fps)/1 ! queue max-size-buffers=3 leaky=downstream ! videoconvert ! videoscale ! <encoder> ! fdsink`. Sin `jpegenc` (solo `vajpegenc`/`avenc_mjpeg`); dimensiones pares preservadas.
- Frame loop: `if (frame.length === 0) continue` (no publicar buffer vacío, seguir en PREROLL).
- stderr filter: ignora `PREROLL / Setting pipeline to PAUSED|PLAYING / buffer size==0`; errores HW (`vajpegenc|vaapi` + `fail|error|cannot|not supported|not-negotiated`) cuentan fallo vía `recordFailure()`; resto de errores conserva el `warn`.

## Tests (`tests/gray-screen.test.ts`, 4 tests)
1. `getEncoderArgs` HW por defecto → 2× `recordFailure()` → software.
2. Fuente `server/streamer.ts` contiene `videoconvert`, `videoscale`, `leaky=downstream`, `max-size-buffers=3`, `format=BGRx`, `framerate=`, `avenc_mjpeg`, sin literal `'jpegenc'`/`"jpegenc"`.
3. `pickPorts` con 2 outPorts del mismo nodo devuelve el primero (10, no 11).
4. `pickPorts` devuelve nulls si node.id / clientName no matchean.

## Notes / deviations
- El brief Step 1 dice pipeline "incluye `videoconvert ! videoscale ! queue leaky`" pero Step 3 ordena `queue … ! videoconvert ! videoscale`; implementé el orden de Step 3 (queue antes de convert/scale, caps antes de queue) y el test verifica presencia, no orden estricto, para satisfacer ambos.
- El test simula los "2 fallos" vía `(s as any).recordFailure()` (método privado real usado por los handlers), en vez de spawnear gst, cumpliendo "sin spawnear gst".
- No se tocó ningún otro archivo; commit solo con los 2 ficheros del brief.

## Fix round (reviewer, 2026-10-13)
Hallazgos aplicados, sin tocar otros archivos:
1. `server/streamer.ts` — guard `frame.length === 0` (inalcanzable, frame SOI..EOI ≥4B) → `frame.length < 800` (JPEG roto → gris, mismo umbral que Task3 `shouldDropFrame`). Test: `frame\.length\s*<\s*800` en fuente.
2. `tests/gray-screen.test.ts` — el test por `readFileSync` no inspeccionaba el array real. Se extrajo `buildGstArgs(opts)` puro exportado (caps + queue leaky + convert/scale + encoder, redondeo par, `target-object` solo con nodeId), usado por `startProcess()` junto a `this.getEncoderArgs()`; nuevos tests inspeccionan el array real (HW/SW, orden caps→queue→convert/scale→encoder→fdsink, `width 393→394`, `target-object=42`) + assert de cableado (`this.getEncoderArgs()` y `buildGstArgs({…encoderArgs` en fuente), sin spawnear gst.
- Verificación: `npx vitest run tests/gray-screen.test.ts` → 7/7 PASS; `npx vitest run` → 5 files, 14 tests PASS; `npx tsc --noEmit` limpio (exit 0).
