# 📱 Hydra Controller — Linux Mobile Deck

[![LAN-Only](https://img.shields.io/badge/Network-LAN%20Only-orange)](#-seguridad)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collected-blue)](#-seguridad)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

> **Convierte tu smartphone o tablet en una pantalla táctil dedicada para tu PC Linux, sin duplicar ni interferir con tu pantalla principal.**

🌐 **Web del proyecto:** desplegada con Cloudflare Pages desde [`landing/`](./landing/) — ábrela, personalízala y publícala con tus cambios.

---

## ⚡ Qué hace

- **Sesiones virtuales aisladas**: cada app se lanza en su propio display virtual con `gamescope` headless, a la resolución de tu móvil (siempre en pares). Tu escritorio principal no se toca.
- **Streaming en tiempo real**: captura por PipeWire (`pipewiresrc`) y JPEG por WebSocket binario, con control de congestión. Sin nube de por medio.
- **Táctil real**: multitouch (hasta 10 dedos), teclado nativo del móvil y botones flotantes (atrás, teclado, pantalla completa, cerrar).
- **Lanzador PWA**: catálogo de tus apps `.desktop` con iconos, búsqueda, categorías y favoritos; multitarea para saltar entre sesiones.
- **Emparejado por QR**: TLS autofirmado generado en tu máquina + código QR en la terminal. Misma Wi-Fi y a jugar.
- **Tests que muerden**: unitarios (Vitest), e2e con detección de frame gris/negro y suite de estrés.

> Estado honesto del proyecto: el vídeo hoy es **MJPEG sobre WebSocket** (no WebRTC/H.264 todavía) y la entrada viaja sobre todo por **X11/xdotool** (las apps se fuerzan a X11). Hay una [lista de ideas para contribuir](#-contribuir) si quieres llevarlo más lejos.

---

## 🧰 Requisitos

- **Linux** con Node.js 20+, `npm`, `gcc`/`make`, `ffmpeg`, `gamescope`, `gstreamer` (plugins base + `avenc_mjpeg` vía libav), `xdotool`, `pw-dump`/`pw-link` (PipeWire) y un emulador de terminal (p. ej. `alacritty` para apps de consola).

```bash
# Arch / CachyOS
sudo pacman -S gcc make ffmpeg gamescope nodejs npm gstreamer gst-libav xdotool pipewire alacritty

# Ubuntu / Debian (nombres orientativos)
sudo apt install gcc make ffmpeg gamescope nodejs npm gstreamer1.0-libav xdotool pipewire alacritty

# Fedora (nombres orientativos)
sudo dnf install gcc make ffmpeg gamescope nodejs npm gstreamer1-libav xdotool pipewire alacritty
```

> **Permisos de `/dev/uinput`** (solo si quieres el puente táctil experimental del host):
> ```bash
> sudo usermod -aG input $USER  # y vuelve a iniciar sesión
> ```

---

## 🚀 Instalación y uso

Dentro de `apps/hydra-controller`:

```bash
npm install          # dependencias
npm run build        # puente uinput (gcc) + interfaz web (tsc + vite)
npm start            # servidor HTTPS en :4096 + QR en la terminal
```

### Conectar el móvil

1. Móvil y PC en la **misma Wi-Fi**.
2. Escanea el QR de la terminal (o abre `https://<IP-del-PC>:4096` / `https://hydra.local:4096`).
3. Acepta el certificado autofirmado (se genera en `.certs/`, nunca se sube a git).
4. Opcional: “Añadir a pantalla de inicio” para modo pantalla completa.
5. Toca una app: se abre maximizada al tamaño de tu pantalla y los toques caen 1:1.

### Desarrollo local

```bash
npm run dev:all     # vite en :5173 (con proxy a /api y /ws) + backend en :4096
```

Abre `http://127.0.0.1:5173`: el proxy de `vite.config.ts` reenvía la API y el WebSocket al backend real, así puedes probar el flujo completo desde el PC.

---

## 🧪 Tests

```bash
npm test             # unitarios (Vitest): scanner, certs, uinput, pantalla gris/negra, táctil, fit
npm run test:e2e     # streaming real + verificación de contenido (falla con GRAY_FRAME si sale gris)
npm run test:stress  # concurrencia, backpressure y limpieza de sesiones
```

---

## 📂 Estructura

```
apps/hydra-controller/
├── landing/                  # Web estática del proyecto (Cloudflare Pages: sin build, carpeta landing/)
├── server/
│   ├── index.ts              # Express + HTTPS + WebSocket /ws, sesiones REST, input binario
│   ├── virtual-display.ts    # Gamescope headless, parseo Xwayland/PipeWire, fit de ventana, input xdotool
│   ├── streamer.ts           # GStreamer pipewiresrc → MJPEG → frames JPEG por WS
│   ├── app-scanner.ts        # Apps .desktop + iconos
│   ├── certs.ts / qr.ts      # TLS autofirmado + QR de emparejado
│   └── uinput-bridge.ts + uinput/hydra-uinput.c  # Puente /dev/uinput (experimental, sin reenvío)
├── src/
│   ├── App.tsx               # Lanzador vs streaming, sesiones, favoritos
│   ├── components/           # StatusBar, AppGrid, StreamView (canvas), RunningTasks
│   ├── hooks/useHydraSocket.ts  # WS, ping/latencia, attach con cola, chunks de vídeo
│   └── lib/frame-guard.ts    # Descarte de frames rotos/grises
└── tests/                    # Vitest + e2e (mjs) + estrés
```

---

## 🩺 Problemas comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Pantalla negra al abrir | El nodo PipeWire tarda o el contenido está estático | Espera unos segundos: el servidor reintenta el enlace y provoca redraw al adjuntar |
| Todo gris | La app no dibuja (falló su `Exec`, terminal sin emulador) | Revisa el log `[hydra-display]`; las apps de consola se envuelven con `alacritty -e` |
| Clicks caen en otro sitio | Ventana aún sin maximizar (apps lentas) | El servidor la maximiza solo (polling hasta 120s); si persiste, mira `xdotool search` en `:N` |
| Clicks en tu escritorio real | Reenvío uinput antiguo | Actualiza: desde `ea6d50a` el input de sesión ya no va al host |
| Certificado rechazado | Autofirmado | Acepta la excepción una vez; verifica IP y huella; renueva borrando `.certs/` |
| `vite` dev sin apps/WS | Sin backend | Arranca también el backend (`npm run dev:all`) o usa `npm start` |

Más detalle técnico en [`GEMINI.md`](./GEMINI.md).

---

## 🤝 Contribuir

¡Nos vendría genial tu ayuda! Ideas con hueco hecho:

- **Teclado completo**: faltan las letras A-Z en el mapa de `sendKeyEvent`.
- **Vídeo H.264/WebRTC** frente al MJPEG actual, con medición de latencia.
- **Input Wayland nativo** más allá del puente X11.
- **Tests en hardware real**, guías y traducciones (primera contribución ideal).

Pasos: fork → rama (`fix/…`, `feat/…`) → PR contando qué probaste en hardware real. Issues y código en <https://github.com/juanpimg/hydracontroller>.

La landing también acepta mejoras: edita [`landing/`](./landing/) y previsualízala con cualquier servidor estático:

```bash
cd landing && python3 -m http.server 8080  # http://127.0.0.1:8080
```

### Desplegar la landing en Cloudflare Pages

1. Sube el repo a GitHub.
2. En Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: *(vacío)* · Output directory: `apps/hydra-controller/landing` (o `landing` si publicas el monorepo desde esa carpeta).
4. Deploy: cada push a `main` republica sola.

---

## 🔒 Seguridad

Solo red local (LAN): nunca lo expongas a Internet. TLS autofirmado en `.certs/`, secretos ignorados (`.env*`, `*.pem`, `*.key`). Sin cuentas ni nube.

---

## ⚖️ Aviso legal

Úsalo solo en equipos y redes propios o de confianza: requiere permisos sensibles (grupo `input`, `/dev/uinput`), ejecuta apps en tu máquina y expone HTTPS en tu LAN. Verifica dirección y huella del certificado. Software “tal cual” bajo licencia MIT, sin garantías.
