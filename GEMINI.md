# 📱 Hydra Controller — Guía Técnica de Arquitectura, Troubleshooting y Sesiones Virtuales

Este documento reúne el estado técnico, la arquitectura de aislamiento, las soluciones aplicadas a problemas críticos (webcam, baja latencia, eventos táctiles) y la hoja de ruta para continuar el desarrollo en próximas sesiones.

---

## 🏗️ 1. Arquitectura del Sistema

```
Dispositivo Móvil (Web / PWA)
      │
      │ 1. HTTPS / WSS (:4096)
      ▼
Servidor Node.js / Express (server/index.ts)
      ├── VirtualDisplayManager (server/virtual-display.ts)
      │      └── Lanza Gamescope aislado en modo headless:
      │          - Resolución nativa móvil par (ej. 720x1280 o escalado par)
      │          - Backend headless (--backend headless --expose-wayland --keep-alive)
      │          - Sin variables del host (WAYLAND_DISPLAY y DISPLAY eliminados)
      │          - Crea un display Xwayland dedicado (ej. :1, :2) y un nodo PipeWire
      │
      ├── Streamer (server/streamer.ts)
      │      └── Pipeline GStreamer de ultra-baja latencia con PipeWire:
      │          - `pipewiresrc autoconnect=false client-name=hydra_stream_*`
      │          - `vajpegenc quality=85` (Intel/AMD VA-API en hardware /dev/dri/renderD128)
      │          - Enlace explícito por puertos de audio/video mediante `pw-link`
      │          - Transmisión instantánea de frames JPEG sobre WebSocket binario
      │
      └── Input Dispatcher (xdotool / uinput)
             └── Conversión de eventos táctiles y teclas:
                 - Web Pointer Events (down/move/up) -> `xdotool mousemove/mousedown/mouseup` en `DISPLAY=:${displayNum}`
                 - Soporte multitáctil opcional vía controlador de kernel `/dev/uinput`
```

---

## 🔒 2. Aislamiento y Reglas Críticas

### 🚫 Prohibición Estricta de Cámara Web (`/dev/video*`)
- **Problema previo detectado:** `pipewiresrc autoconnect=true` o scripts con webcam provocaban que PipeWire autovinculara la webcam integrada de la laptop (`/dev/video0`), mostrando la cara del usuario en el móvil en lugar de la app.
- **Solución implementada:**
  - `pipewiresrc autoconnect=false` es **obligatorio** en todos los pipelines.
  - Ningún script ni componente puede invocar `v4l2src` o `/dev/video*`.
  - El enlace con Gamescope se realiza exclusivamente mediante identificación del nodo PipeWire de Gamescope (`pw-dump`) y vinculación directa de puertos (`pw-link`).
  - Verificación en tests con `fuser /dev/video0` para asegurar que el dispositivo de cámara está libre.

### 🖥️ Aislamiento de Pantalla del Host
- Las aplicaciones ejecutadas desde el móvil se confinan a Gamescope. No deben invadir el escritorio principal del PC ni compartir variables `DISPLAY=:0` del host.

---

## 🔍 3. Diagnóstico del Estado Actual ("No da imagen en el móvil ahora")

Durante las pruebas reales desde el móvil, se identificaron las causas raíz del fallo al abrir apps:

### A. Fallo de Ejecución Inmediata de Apps (.desktop)
1. **Aplicaciones de consola (ej. `btop++`):**
   - Cuando se abre `btop`, Gamescope finalizaba inmediatamente con código de salida `0` porque `btop` requiere una TTY/terminal interactivo.
   - **Solución requerida:** En `server/index.ts`, las aplicaciones marcadas con `Terminal=true` o ejecutables CLI deben envolverse siempre en un emulador de terminal gráfico:
     ```ts
     execCmd = `alacritty -e ${execCmd}`;
     ```
2. **Aplicaciones Qt/KDE (ej. Dolphin):**
   - Al ejecutarse sin contexto de sesión KDE ni `WAYLAND_DISPLAY`, pueden cerrarse al no detectar el compositor de escritorio.
   - **Solución requerida:** Asegurar que `XDG_RUNTIME_DIR` y variables necesarias como `QT_QPA_PLATFORM=xcb` o `wayland` se configuren adecuadamente para el entorno aislado de Gamescope.

### B. Resoluciones Impares del Viewport Móvil
- El navegador móvil Safari/Chrome reporta dimensiones CSS como `393x695`.
- Pasar dimensiones impares a Gamescope y a los codificadores de vídeo (`vajpegenc` o codecs H.264) provoca rechazo en la negociación de `caps` de GStreamer (`width` o `height` no múltiplos de 2 o 16).
- **Solución requerida:**
  - Redondear siempre las dimensiones a números pares en el servidor:
    ```ts
    const safeWidth = Math.ceil(width / 2) * 2;
    const safeHeight = Math.ceil(height / 2) * 2;
    ```
  - O fijar un lienzo virtual estándar adaptativo (por ejemplo `720x1280` o `1080x1920`) y escalar en el `<canvas>` del cliente móvil.

### C. Codificador de Respaldo en Streamer
- Si `vajpegenc` falla por cualquier circunstancia del hardware en un formato específico, debe existir un fallback limpio a `avenc_mjpeg` o `jpegenc` para garantizar que la transmisión nunca se quede colgada.

---

## ⚡ 4. Puntos de Entrada y Archivos Clave

| Archivo | Responsabilidad |
|---|---|
| [`server/index.ts`](file:///home/jp/Escritorio/Proyectos/HydraApps/apps/hydra-controller/server/index.ts) | Servidor Express, WebSocket signaling, dispatch de apps y eventos de entrada. |
| [`server/virtual-display.ts`](file:///home/jp/Escritorio/Proyectos/HydraApps/apps/hydra-controller/server/virtual-display.ts) | Gestión de procesos Gamescope, monitorización de logs (Xwayland / PipeWire node). |
| [`server/streamer.ts`](file:///home/jp/Escritorio/Proyectos/HydraApps/apps/hydra-controller/server/streamer.ts) | Captura de PipeWire, codificación VA-API hardware (`vajpegenc`) y envío de frames. |
| [`server/uinput-bridge.ts`](file:///home/jp/Escritorio/Proyectos/HydraApps/apps/hydra-controller/server/uinput-bridge.ts) | Puente de eventos táctiles `/dev/uinput` y fallback a `xdotool`. |
| [`src/components/StreamView.tsx`](file:///home/jp/Escritorio/Proyectos/HydraApps/apps/hydra-controller/src/components/StreamView.tsx) | Componente Canvas en React, renderizado de imagen a 60 FPS y mapeo de coordenadas táctiles. |

---

## 🧪 5. Comandos de Verificación y Pruebas

```bash
# 1. Pruebas unitarias
npm test

# 2. Prueba End-to-End de streaming y verificación de no-acceso a webcam
npm run test:e2e

# 3. Suite de pruebas de estrés (concurrencia, fugas de memoria, robustez de red)
npm run test:stress

# 4. Sonda manual gris vs contenido (guardar 1 chunk WS como /tmp/probe.mjpeg y medir varianza):
# node tests/e2e-stream.mjs  # el e2e ya calcula mean+stddev y falla con GRAY_FRAME si vari<90 && 40<mean<215
# ffmpeg -i /tmp/probe.mjpeg -f rawvideo -pix_fmt gray pipe:1 | python3 -c "import sys,math; d=sys.stdin.buffer.read(); m=sum(d)/len(d); v=sum((b-m)**2 for b in d)/len(d); print(f'mean={m:.1f} stddev={math.sqrt(v):.1f} ' + ('GRAY_FRAME' if v<90 and 40<m<215 else 'CONTENIDO'))"
# ffprobe -v error -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1 /tmp/probe.mjpeg
```

---

## 📋 6. Tareas Pendientes para la Siguiente Sesión

1. [ ] **Envolver aplicaciones CLI:** Implementar en `server/index.ts` la detección automática y envoltura en `alacritty -e` para aplicaciones de consola.
2. [ ] **Sanitización de dimensiones:** Forzar múltiplos de 2 o 16 para `width` y `height` en `server/virtual-display.ts` y `server/index.ts`.
3. [ ] **Fallback de encoder:** Incorporar fallback en `server/streamer.ts` en caso de fallo del elemento `vajpegenc`.
4. [ ] **Validación en móvil real:** Conectar nuevamente desde Safari/Chrome móvil y probar apertura de aplicaciones nativas (Firefox, Dolphin, Alacritty/btop) comprobando fluidez y respuesta táctil.
