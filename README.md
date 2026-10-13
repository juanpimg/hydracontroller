# 📱 Hydra Controller — Linux Mobile Deck

[![LAN-Only](https://img.shields.io/badge/Network-LAN%20Only-orange)](#)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collected-blue)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

> **Convierte tu smartphone o tablet en un escritorio táctil dedicado y ultra-rápido para tu ordenador Linux, sin duplicar ni interferir con tu pantalla principal.**

---

## ⚡ Características Principales

- **Sesión Virtual Dedicada e Independiente**:
  - No duplica tu pantalla: ejecuta las aplicaciones en un compositor virtual aislado (`gamescope` en modo headless) ajustado pixel a pixel a la resolución, DPI y orientación de tu móvil.
  - Tu pantalla principal y tus ventanas normales del PC quedan 100% libres y sin interrupciones.

- **Lanzador Web / PWA Táctil Nativo**:
  - Interfaz moderna, fluida y adaptada a dedos con la estética del ecosistema Hydra Apps.
  - Escaneo automático de todas las aplicaciones `.desktop` instaladas en tu sistema Linux con iconos de alta resolución y filtro por categorías (Internet, Multimedia, Sistema, Desarrollo, etc.).
  - Favoritos fijables con estrella y gestor multitarea para cambiar de ventana al instante.

- **Emulación Táctil Pura Absoluta (`/dev/uinput`)**:
  - Convierte los eventos táctiles del navegador en eventos de hardware reales en el kernel de Linux (`EV_ABS`, slots multitouch `ABS_MT_POSITION_X` / `ABS_MT_POSITION_Y`).
  - Mapeo nativo hasta 10 dedos simultáneos: pellizcar para hacer zoom, deslizamientos, botones y gestos responden de forma 100% nativa.

- **Streaming WebRTC / WebCodecs de Ultra-Baja Latencia (<30ms)**:
  - Transmisión en tiempo real en H.264 acelerado por hardware (NVENC para NVIDIA o VA-API para Intel/AMD).
  - Decodificación por hardware inmediata en el navegador móvil mediante la API WebCodecs.

- **Audio Conmutable con PipeWire**:
  - Escucha el audio de tus aplicaciones directamente en los altavoces o auriculares de tu móvil mediante compresión Opus de baja latencia, o conmútalo a los altavoces de tu PC con un solo toque.

- **Teclado Nativo Móvil**:
  - Botón integrado para desplegar el teclado de tu móvil (Gboard, iOS keyboard, etc.) e introducir texto directamente en terminales, navegadores o editores.

- **Emparejamiento Instantáneo por Código QR**:
  - El servidor genera automáticamente certificados TLS autofirmados para garantizar acceso seguro y muestra un código QR en la terminal para conectar al instante desde la misma red Wi-Fi.

---

## 🚀 Inicio Rápido

### 1. Requisitos Previos

En distribuciones basadas en Arch Linux / Fedora / Ubuntu:
```bash
# Compilador y herramientas básicas
sudo pacman -S gcc make ffmpeg gamescope nodejs npm
```

> **Permisos de uinput**: Asegúrate de que tu usuario tenga permisos de lectura y escritura en `/dev/uinput` (generalmente perteneciendo al grupo `input`):
> ```bash
> sudo usermod -aG input $USER
> ```

### 2. Instalación y Compilación

Dentro del directorio `apps/hydra-controller`:
```bash
# Instalar dependencias
npm install

# Compilar el puente táctil nativo y la interfaz web PWA
npm run build
```

### 3. Iniciar el Servidor

```bash
npm start
```

En la consola aparecerá un código QR con la dirección local (por ejemplo `https://192.168.1.145:8443` y `https://hydra.local:8443`).

### 4. Conectar desde el Móvil

1. Asegúrate de que tu móvil esté conectado a la **misma red Wi-Fi** que tu PC.
2. Abre la cámara de tu teléfono y escanea el código QR que muestra la terminal (o introduce la dirección en Safari / Chrome).
3. Acepta el certificado autofirmado local.
4. *(Opcional)* Toca en **"Añadir a la pantalla de inicio"** para usarlo como aplicación independiente a pantalla completa.
5. ¡Toca cualquier aplicación para abrirla en una sesión dedicada y disfrutar de la experiencia táctil nativa!

---

## 📂 Arquitectura del Proyecto

```
apps/hydra-controller/
├── server/
│   ├── index.ts                # Daemon principal Express + HTTPS + WebSockets
│   ├── app-scanner.ts          # Indexador de aplicaciones .desktop y resolución de iconos
│   ├── certs.ts                # Generador automático de certificados TLS locales
│   ├── qr.ts                   # Generador de códigos QR y detección de IP en red local
│   ├── streamer.ts             # Pipeline de streaming H.264 de ultra-baja latencia
│   ├── virtual-display.ts      # Gestor de sesiones virtuales con Gamescope
│   ├── uinput-bridge.ts        # Controlador Node para el puente de eventos táctiles
│   └── uinput/
│       └── hydra-uinput.c      # Driver nativo en C para el kernel Linux (/dev/uinput)
├── src/
│   ├── App.tsx                 # Coordinador principal (Lanzador vs Streaming)
│   ├── components/
│   │   ├── AppGrid.tsx         # Catálogo de aplicaciones con búsqueda y categorías
│   │   ├── RunningTasks.tsx    # Barra multitarea inferior y cierre de sesiones
│   │   ├── StatusBar.tsx       # Latencia en vivo, audio toggle y estado de red
│   │   └── StreamView.tsx      # Visor táctil a 60 FPS con teclado nativo
│   ├── hooks/
│   │   └── useHydraSocket.ts   # Conexión WebSocket y paquetes binarios táctiles
│   └── styles/
│       └── index.css           # Estilos Tailwind y optimizaciones touch-none
└── tests/                      # Suite de pruebas automatizadas con Vitest
```

---

## 🧪 Pruebas Automatizadas

Para ejecutar la batería de pruebas:
```bash
npm test
```

---

## 🔒 Seguridad

Servidor solo para tu red local (LAN). Los certificados TLS se generan en tu máquina
(`.certs/`, ignorado en `.gitignore`) y **nunca deben subirse a GitHub**. Sin cuentas,
sin nube: ningún secreto en el repo (`.env*`, `*.pem`, `*.key` ignorados).

---

## ⚖️ Aviso legal

- **Ámbito de uso:** úsalo únicamente en equipos y redes propios o de confianza. El servidor requiere permisos sensibles del sistema (grupo `input`, `/dev/uinput`), ejecuta aplicaciones en tu máquina y expone un puerto HTTPS en tu red local: no lo expongas a Internet.
- **Certificado autofirmado:** verifica la dirección y la huella del certificado antes de conectar tus dispositivos.
- **Sin garantías:** software "tal cual" (licencia MIT). El autor no responde de daños directos o indirectos, pérdidas de datos ni accesos no autorizados derivados de su instalación, configuración o uso. La responsabilidad es exclusivamente tuya.
