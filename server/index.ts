import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { getOrCreateCertificates } from './certs.ts';
import { scanLinuxApps, LinuxApp } from './app-scanner.ts';
import { UInputBridge } from './uinput-bridge.ts';
import { VirtualDisplayManager, classifyTouchEvent } from './virtual-display.ts';
import { AppStreamer } from './streamer.ts';
import { displayConnectionBanner } from './qr.ts';

const PORT = parseInt(process.env.PORT || '4096', 10);
const APP_DIR = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(APP_DIR, 'dist');
const CERTS_DIR = path.join(APP_DIR, '.certs');

const app = express();
app.use(express.json());

// Initialize Core Subsystems
const uinput = new UInputBridge();
uinput.start(1920, 1080);

const displayManager = new VirtualDisplayManager();
let cachedApps: LinuxApp[] = [];

// Refresh Apps Cache
function refreshApps() {
  try {
    cachedApps = scanLinuxApps();
    console.log(`[hydra-server] Indexadas ${cachedApps.length} aplicaciones del sistema`);
  } catch (err) {
    console.error('[hydra-server] Error escaneando aplicaciones:', err);
  }
}
refreshApps();

// REST API Endpoints
app.get('/api/apps', (_req, res) => {
  res.json(cachedApps);
});

app.get('/api/apps/refresh', (_req, res) => {
  refreshApps();
  res.json({ count: cachedApps.length });
});

app.get('/api/apps/icon/:id', (req, res) => {
  const targetApp = cachedApps.find(a => a.id === req.params.id);
  if (targetApp && targetApp.iconPath && fs.existsSync(targetApp.iconPath)) {
    return res.sendFile(targetApp.iconPath);
  }

  // Fallback to default icon
  const defaultIcon = path.join(APP_DIR, 'public/icon.svg');
  if (fs.existsSync(defaultIcon)) {
    return res.sendFile(defaultIcon);
  }
  res.status(404).send('Not found');
});

app.get('/api/sessions', (_req, res) => {
  res.json(displayManager.getSessions());
});

app.post('/api/sessions/launch', (req, res) => {
  const { appId, width = 720, height = 1280 } = req.body;
  const targetApp = cachedApps.find(a => a.id === appId);

  if (!targetApp) {
    return res.status(404).json({ error: 'Aplicación no encontrada' });
  }

  try {
    let execCmd = targetApp.exec;
    if (targetApp.terminal) {
      execCmd = `alacritty -e ${execCmd}`;
    }

    const session = displayManager.launchApp(
      targetApp.id,
      targetApp.name,
      execCmd,
      width,
      height
    );
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/terminate', (req, res) => {
  const { sessionId } = req.body;
  const success = displayManager.terminateSession(sessionId);
  res.json({ success });
});

// Serve frontend dist or static fallback
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send(`
      <div style="font-family:sans-serif;background:#07090e;color:#eee;height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column">
        <h2>Hydra Controller Server is Running</h2>
        <p>Vite dev server is serving the UI or run <code>npm run build:ui</code></p>
      </div>
    `);
  });
}

// Create HTTPS Server for secure mobile WebRTC/Touch context
const certs = getOrCreateCertificates(CERTS_DIR);
const server = https.createServer({ key: certs.key, cert: certs.cert }, app);

// Setup WebSocket Server for low-latency touch events, signals and video
const wss = new WebSocketServer({ server, path: '/ws' });

const activeStreamers = new Map<string, AppStreamer>();

wss.on('connection', (ws: WebSocket) => {
  let attachedSessionId: string | null = null;
  let cleanupPendingAttach: (() => void) | null = null;
  // Estado táctil por slot: el protocolo 0x01 no trae tipo, se infiere
  // comparando trackingId con el último visto en ese slot
  const slotTracking = new Map<number, number>();

  const detachCurrentStream = () => {
    if (cleanupPendingAttach) {
      cleanupPendingAttach();
      cleanupPendingAttach = null;
    }
    if (attachedSessionId) {
      const streamer = activeStreamers.get(attachedSessionId);
      if (streamer) {
        streamer.removeClient(ws);
        if (streamer.getClientCount() === 0) {
          activeStreamers.delete(attachedSessionId);
        }
      }
      attachedSessionId = null;
    }
  };

  ws.on('error', (err) => {
    console.warn('[hydra-server] WebSocket error:', err.message);
  });

  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (isBinary && Buffer.isBuffer(data)) {
      // Binary Touch / Key packet from Mobile Web Client
      const packetType = data.readUInt8(0);

      if (packetType === 0x01 && data.length >= 9) {
        // Touch Event
        const slot = data.readUInt8(1);
        const trackingId = data.readInt16LE(2);
        const x = data.readUInt16LE(4);
        const y = data.readUInt16LE(6);
        const pressure = data.readUInt8(8);
        uinput.sendTouchEvent(slot, trackingId, x, y, pressure);

        // Also route directly to the active virtual session's Gamescope X11 display
        if (attachedSessionId) {
          const type = classifyTouchEvent(slotTracking.get(slot), trackingId, pressure);
          if (type === 'up') slotTracking.delete(slot);
          else slotTracking.set(slot, trackingId);
          displayManager.sendPointerEvent(attachedSessionId, type, x, y);
        }
      } else if (packetType === 0x02 && data.length >= 2) {
        // Sync Event
        const activeCount = data.readUInt8(1);
        uinput.sendSync(activeCount);
      } else if (packetType === 0x03 && data.length >= 4) {
        // Key Event
        const keycode = data.readUInt16LE(1);
        const isDown = data.readUInt8(3) === 1;
        uinput.sendKeyEvent(keycode, isDown);
        if (attachedSessionId) {
          displayManager.sendKeyEvent(attachedSessionId, keycode, isDown);
        }
      }
    } else {
      // JSON Control Message
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        } else if (msg.type === 'detach_stream') {
          detachCurrentStream();
        } else if (msg.type === 'attach_stream') {
          const { sessionId, width = 720, height = 1280, fps = 30 } = msg;
          const session = displayManager.getSession(sessionId);
          if (session) {
            // If already attached to a different session, detach from it first
            if (attachedSessionId && attachedSessionId !== sessionId) {
              detachCurrentStream();
            } else if (cleanupPendingAttach) {
              cleanupPendingAttach();
              cleanupPendingAttach = null;
            }

            attachedSessionId = sessionId;
            let streamer = activeStreamers.get(sessionId);
            if (!streamer) {
              streamer = new AppStreamer({
                displayNum: session.displayNum,
                width,
                height,
                fps,
                pipewireNodeId: session.pipewireNodeId,
              });
              activeStreamers.set(sessionId, streamer);
            }

            let started = false;

            const startIt = () => {
              if (started) return;
              started = true;
              if (cleanupPendingAttach) {
                cleanupPendingAttach();
                cleanupPendingAttach = null;
              }
              // Verify session is still actively running and socket is open
              // Lee displayNum fresco (la referencia puede haber mutado tras display-ready)
              const fresh = displayManager.getSession(sessionId);
              if (fresh && streamer && ws.readyState === ws.OPEN) {
                streamer.updateDisplayNum(fresh.displayNum);
                if (fresh.pipewireNodeId) {
                  streamer.updatePipewireNodeId(fresh.pipewireNodeId);
                }
                streamer.addClient(ws);
              }
            };

            if (session.isReady) {
              startIt();
            } else {
              const onDisplayReady = (readySession: any) => {
                if (readySession.id === sessionId) {
                  startIt();
                }
              };

              const onSessionClosed = (closedId: string) => {
                if (closedId === sessionId) {
                  if (cleanupPendingAttach) {
                    cleanupPendingAttach();
                    cleanupPendingAttach = null;
                  }
                  if (attachedSessionId === sessionId) {
                    attachedSessionId = null;
                  }
                }
              };

              displayManager.on('display-ready', onDisplayReady);
              displayManager.on('session-closed', onSessionClosed);

              // 5-second fallback timeout in case Gamescope output delay
              const fallbackTimer = setTimeout(() => {
                if (!started) {
                  console.warn(`[hydra-server] Display ready signal delayed, forcing stream attach for ${sessionId}`);
                  startIt();
                }
              }, 5000);

              cleanupPendingAttach = () => {
                clearTimeout(fallbackTimer);
                displayManager.off('display-ready', onDisplayReady);
                displayManager.off('session-closed', onSessionClosed);
              };
            }
          }
        }
      } catch {
        // Ignore malformed text packets
      }
    }
  });

  ws.on('close', () => {
    detachCurrentStream();
  });
});

displayManager.on('display-num', (readySession) => {
  const streamer = activeStreamers.get(readySession.id);
  if (streamer) {
    streamer.updateDisplayNum(readySession.displayNum);
  }
});

displayManager.on('pipewire-node', (readySession) => {
  const streamer = activeStreamers.get(readySession.id);
  if (streamer && readySession.pipewireNodeId) {
    streamer.updatePipewireNodeId(readySession.pipewireNodeId);
  }
});

displayManager.on('session-closed', (closedId: string) => {
  const streamer = activeStreamers.get(closedId);
  if (streamer) {
    streamer.stop();
    activeStreamers.delete(closedId);
  }
  for (const client of wss.clients) {
    if (client.readyState === 1 /* WebSocket.OPEN */) {
      try {
        client.send(JSON.stringify({ type: 'session_closed', sessionId: closedId }));
      } catch {}
    }
  }
});

// Graceful Shutdown
const shutdown = () => {
  console.log('\n[hydra-server] Stopping Hydra Controller daemon...');
  for (const streamer of activeStreamers.values()) {
    streamer.stop();
  }
  activeStreamers.clear();
  displayManager.terminateAll();
  uinput.stop();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  displayConnectionBanner(PORT);
});
