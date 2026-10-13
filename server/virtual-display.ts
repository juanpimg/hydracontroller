import { spawn, ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';

export interface RunningSession {
  id: string;
  appId: string;
  appName: string;
  pid?: number;
  width: number;
  height: number;
  displayNum: number;
  isReady: boolean;
  pipewireNodeId?: number;
  startedAt: number;
}

export type TouchType = 'down' | 'move' | 'up';

// Clasifica un evento táctil por estado del slot: el protocolo 0x01 no trae
// tipo, solo (trackingId, pressure). Sin esto el move llegaba como down repetido.
export function classifyTouchEvent(
  prevTrackingId: number | undefined,
  trackingId: number,
  pressure: number
): TouchType {
  if (trackingId === -1 || pressure <= 0) return 'up';
  if (prevTrackingId === undefined || prevTrackingId === -1 || prevTrackingId !== trackingId) return 'down';
  return 'move';
}

export class VirtualDisplayManager extends EventEmitter {
  private activeSessions = new Map<string, { session: RunningSession; proc: ChildProcess }>();

  constructor() {
    super();
  }

  public getSessions(): RunningSession[] {
    return Array.from(this.activeSessions.values()).map(v => v.session);
  }

  public getSession(id: string): RunningSession | undefined {
    return this.activeSessions.get(id)?.session;
  }

  public isAppAlive(sessionId: string): boolean {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;
    return entry.proc.exitCode === null && entry.proc.killed !== true;
  }

  // Foco inicial best-effort tras display-ready (fire-and-forget, nunca bloquea
  // ni lanza): activa la ventana visible, centra el puntero y envía click 1
  // para que haya app real al frente en vez del fondo gris del compositor.
  private focusAfterReady(displayNum: number, width: number, height: number): void {
    try {
      const env = { ...process.env, DISPLAY: `:${displayNum}` };
      const cx = String(Math.round(width / 2));
      const cy = String(Math.round(height / 2));
      const seq: string[][] = [
        ['search', '--onlyvisible', '--class', '.', 'windowactivate'],
        ['mousemove', cx, cy],
        ['click', '1'],
      ];
      for (const args of seq) {
        try {
          const child = spawn('xdotool', args, { env, stdio: 'ignore' });
          child.on('error', () => {});
        } catch {}
      }
    } catch {}
  }

  public launchApp(appId: string, appName: string, execCmd: string, width = 720, height = 1280): RunningSession {
    if (!execCmd || !execCmd.trim()) {
      throw new Error('[hydra-display] execCmd vacío: se requiere un comando para confinar en gamescope');
    }
    const sessionId = `session_${Date.now()}`;
    // Gamescope/YUV420 exigen dimensiones pares; el móvil manda CSS px que pueden ser impares
    const evenW = Math.ceil(width / 2) * 2;
    const evenH = Math.ceil(height / 2) * 2;

    console.log(`[hydra-display] Launching isolated virtual session ${sessionId} for ${appName} (${evenW}x${evenH})`);

    // Build gamescope arguments
    const args = [
      '-W', String(evenW),
      '-H', String(evenH),
      '-w', String(evenW),
      '-h', String(evenH),
      '-r', '60',
      '--backend', 'headless',
      '--expose-wayland',
      '--keep-alive',
      '--',
      'sh', '-c', execCmd,
    ];

    // Strip outer host display variables so the app is strictly confined to gamescope.
    // Fuerza toolkits a X11: xdotool inyecta vía XTEST en el Xwayland :N y en un
    // cliente Wayland nativo no hace absolutamente nada.
    const env = {
      ...process.env,
      GDK_BACKEND: 'x11',
      QT_QPA_PLATFORM: 'xcb',
      SDL_VIDEODRIVER: 'x11',
    };
    delete env.WAYLAND_DISPLAY;
    delete env.DISPLAY;

    const proc = spawn('gamescope', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    const session: RunningSession = {
      id: sessionId,
      appId,
      appName,
      pid: proc.pid || 0,
      width: evenW,
      height: evenH,
      displayNum: 0, // 0 = sin asignar; el safety-check del streamer bloquea captura hasta display-ready
      isReady: false,
      startedAt: Date.now(),
    };

    // Monitor gamescope output to parse Xwayland display and PipeWire node ID.
    // gamescope vuelca el log a stderr o a stdout según versión/flags: escuchar ambos.
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      // Strip ANSI color codes from gamescope logs
      const cleanText = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      // Look for: [xwayland/server.c:107] Starting Xwayland on :1
      const matchX = cleanText.match(/Starting Xwayland on :(\d+)/);
      if (matchX && !session.isReady) {
        session.displayNum = parseInt(matchX[1], 10);
        session.isReady = true;
        console.log(`[hydra-display] Session ${sessionId} (${appName}) assigned DISPLAY=:${session.displayNum}`);
        this.emit('display-num', session);
        this.emit('display-ready', session);
        // Foco inicial best-effort: sin app al frente gamescope compone fondo gris
        this.focusAfterReady(session.displayNum, evenW, evenH);
      }

      // Look for: pipewire: stream available on node ID: <id>
      const matchPW = cleanText.match(/pipewire:\s*stream available on node ID:\s*(\d+)/i);
      if (matchPW) {
        session.pipewireNodeId = parseInt(matchPW[1], 10);
        console.log(`[hydra-display] Session ${sessionId} (${appName}) PipeWire node detected: ${session.pipewireNodeId}`);
        this.emit('pipewire-node', session);
      }
    };

    proc.stderr.on('data', handleOutput);
    proc.stdout?.on('data', handleOutput);

    proc.on('error', (err) => {
      console.error(`[hydra-display] Failed to spawn gamescope for session ${sessionId}:`, err);
      if (this.activeSessions.has(sessionId)) {
        this.activeSessions.delete(sessionId);
        this.emit('session-closed', sessionId);
      }
    });

    proc.on('exit', (code) => {
      console.log(`[hydra-display] Session ${sessionId} (${appName}) closed with code ${code}`);
      if (this.activeSessions.has(sessionId)) {
        this.activeSessions.delete(sessionId);
        this.emit('session-closed', sessionId);
      }
    });

    this.activeSessions.set(sessionId, { session, proc });
    this.emit('session-started', session);

    return session;
  }

  public terminateSession(sessionId: string): boolean {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;

    console.log(`[hydra-display] Terminating session ${sessionId}`);
    try {
      entry.proc.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        try {
          entry.proc.kill('SIGKILL');
        } catch {}
      }, 2000);
      entry.proc.once('exit', () => clearTimeout(killTimer));
    } catch {}

    this.activeSessions.delete(sessionId);
    this.emit('session-closed', sessionId);
    return true;
  }

  public sendPointerEvent(sessionId: string, type: 'down' | 'move' | 'up', x: number, y: number) {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return;
    // Sin display asignado aún, DISPLAY sería :0 (el host): nunca inyectar ahí
    if (entry.session.displayNum <= 0) return;
    const disp = `:${entry.session.displayNum}`;
    const intX = Math.round(x);
    const intY = Math.round(y);

    if (type === 'down') {
      spawn('xdotool', ['mousemove', String(intX), String(intY), 'mousedown', '1'], {
        env: { ...process.env, DISPLAY: disp },
        stdio: 'ignore',
      });
    } else if (type === 'move') {
      spawn('xdotool', ['mousemove', String(intX), String(intY)], {
        env: { ...process.env, DISPLAY: disp },
        stdio: 'ignore',
      });
    } else if (type === 'up') {
      spawn('xdotool', ['mouseup', '1'], {
        env: { ...process.env, DISPLAY: disp },
        stdio: 'ignore',
      });
    }
  }

  public sendKeyEvent(sessionId: string, keycode: number, isDown: boolean) {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return;
    if (entry.session.displayNum <= 0) return;
    const disp = `:${entry.session.displayNum}`;

    // Map common Linux keycodes to xdotool keysyms
    const keyMap: Record<number, string> = {
      1: 'Escape',
      14: 'BackSpace',
      15: 'Tab',
      28: 'Return',
      29: 'Control_L',
      42: 'Shift_L',
      56: 'Alt_L',
      57: 'space',
      103: 'Up',
      105: 'Left',
      106: 'Right',
      108: 'Down',
    };

    const keyName = keyMap[keycode];
    if (keyName && isDown) {
      spawn('xdotool', ['key', keyName], {
        env: { ...process.env, DISPLAY: disp },
        stdio: 'ignore',
      });
    }
  }

  public terminateAll() {
    for (const [id, entry] of this.activeSessions.entries()) {
      try {
        entry.proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try {
            entry.proc.kill('SIGKILL');
          } catch {}
        }, 2000);
        entry.proc.once('exit', () => clearTimeout(killTimer));
      } catch {}
      this.emit('session-closed', id);
    }
    this.activeSessions.clear();
  }
}
