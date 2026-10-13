import { spawn, ChildProcess, execFileSync } from 'node:child_process';
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

export interface AppWindow {
  id: string;
  x?: number;
  y?: number;
  w: number;
  h: number;
}

// True si la ventana ya ocupa todo el display: el polling para aquí.
// Sin esto los reintentos fijos se agotan antes de que apps lentas
// (Firefox frío) mapeen su ventana y el crop queda para siempre.
export function windowFits(win: AppWindow, width: number, height: number): boolean {
  return (win.x ?? 0) === 0 && (win.y ?? 0) === 0 && win.w === width && win.h === height;
}

// Elige la ventana principal (mayor área): gamescope escala la ventana X11 al
// output y cualquier mapeo táctil/frame deja de ser 1:1. Maximizando la ventana
// al tamaño del display el mapeo vuelve a ser 1:1 y la imagen llena la pantalla.
export function pickMainWindow(wins: AppWindow[]): string | null {
  let best: string | null = null;
  let bestArea = 0;
  for (const w of wins) {
    const area = w.w * w.h;
    if (area > bestArea) {
      bestArea = area;
      best = w.id;
    }
  }
  return best;
}

export function buildFitCommands(winId: string, width: number, height: number): string[][] {
  return [
    ['windowsize', winId, String(width), String(height)],
    ['windowmove', winId, '0', '0'],
    ['windowraise', winId],
  ];
}

// Mapa keycode evdev -> keysym X11 para xdotool.
// Letras: KEY_A=30 ... KEY_Z=44. Dígitos fila superior: KEY_1=2 ... KEY_0=11.
const EVDEV_TO_KEYSYM: Record<number, string> = {
  1: 'Escape',
  2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
  12: 'minus', 13: 'equal',
  14: 'BackSpace',
  15: 'Tab',
  16: 'q', 17: 'w', 18: 'e', 19: 'r', 20: 't', 21: 'y', 22: 'u', 23: 'i',
  24: 'o', 25: 'p',
  26: 'bracketleft', 27: 'bracketright',
  28: 'Return',
  29: 'Control_L',
  30: 'a', 31: 's', 32: 'd', 33: 'f', 34: 'g', 35: 'h', 36: 'j', 37: 'k', 38: 'l',
  39: 'semicolon', 40: 'apostrophe',
  41: 'grave',
  42: 'Shift_L',
  43: 'backslash',
  44: 'z', 45: 'x', 46: 'c', 47: 'v', 48: 'b', 49: 'n', 50: 'm',
  51: 'comma', 52: 'period', 53: 'slash',
  56: 'Alt_L',
  57: 'space',
  103: 'Up',
  105: 'Left',
  106: 'Right',
  108: 'Down',
};

export function keycodeToKeysym(keycode: number): string | undefined {
  return EVDEV_TO_KEYSYM[keycode];
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

  // Maximiza la ventana principal al tamaño del display (best-effort, nunca
  // bloquea ni lanza): sin esto gamescope escala la ventana X11 al output,
  // el táctil cae en otro widget y la imagen no llena la pantalla.
  // También se llama desde attach_stream: la ventana suele mapear tarde
  // (Qt frío ~40s) y display-ready llega pronto.
  // Polling hasta encajar (máx 120s): los reintentos fijos se agotaban antes
  // de que apps lentas (Firefox frío, minutos) mapeen su ventana.
  private fitPolls = new Map<string, NodeJS.Timeout>();

  public fitSessionWindows(sessionId: string): void {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return;
    this.fitAfterReady(entry.session.displayNum, entry.session.width, entry.session.height, sessionId);
  }

  private fitAfterReady(displayNum: number, width: number, height: number, sessionId?: string): void {
    if (sessionId) {
      const prev = this.fitPolls.get(sessionId);
      if (prev) clearInterval(prev);
    }
    // Polling hasta encajar (máx 120s): la ventana mapea tarde (Qt frío ~40s,
    // Firefox frío minutos) y los reintentos fijos se agotaban antes.
    // Para cuando encaja para no spamear xdotool.
    let elapsed = 0;
    const poll = () => {
      elapsed += 4000;
      // Sesión cerrada o display inválido: parar
      if (sessionId && !this.activeSessions.has(sessionId)) {
        if (sessionId) { clearInterval(timer); this.fitPolls.delete(sessionId); }
        return;
      }
      if (displayNum <= 0) return;
      try {
        const env = { ...process.env, DISPLAY: `:${displayNum}` };
        const out = execFileSync('xdotool', ['search', '--onlyvisible', '--class', '.'], {
          env, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString();
        const wins: AppWindow[] = [];
        for (const id of out.split(/\s+/).filter(Boolean)) {
          try {
            const g = execFileSync('xdotool', ['getwindowgeometry', '--shell', id], {
              env, stdio: ['ignore', 'pipe', 'ignore'],
            }).toString();
            const x = parseInt(g.match(/^X=(-?\d+)/m)?.[1] || '0', 10);
            const y = parseInt(g.match(/^Y=(-?\d+)/m)?.[1] || '0', 10);
            const w = parseInt(g.match(/WIDTH=(\d+)/)?.[1] || '0', 10);
            const h = parseInt(g.match(/HEIGHT=(\d+)/)?.[1] || '0', 10);
            if (w > 0 && h > 0) wins.push({ id, x, y, w, h });
          } catch { /* ventana fugaz, ignora y sigue */ }
        }
        const mainId = pickMainWindow(wins);
        if (!mainId) return;
        const main = wins.find((w) => w.id === mainId)!;
        if (windowFits(main, width, height)) {
          clearInterval(timer);
          if (sessionId) this.fitPolls.delete(sessionId);
          return;
        }
        for (const args of buildFitCommands(mainId, width, height)) {
          try {
            execFileSync('xdotool', args, { env, stdio: 'ignore' });
          } catch { /* siguiente poll lo reintenta */ }
        }
      } catch { /* display aún no listo, siguiente poll lo cubre */ }
      if (elapsed >= 120000) {
        clearInterval(timer);
        if (sessionId) this.fitPolls.delete(sessionId);
      }
    };
    const timer = setInterval(poll, 4000);
    if (sessionId) this.fitPolls.set(sessionId, timer);
    // Primer intento sin esperar al intervalo
    setTimeout(poll, 500);
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
        // Ventana a tamaño display (mapeo 1:1) + foco inicial: sin app al
        // frente gamescope compone fondo gris
        this.fitAfterReady(session.displayNum, evenW, evenH, sessionId);
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
    const fitPoll = this.fitPolls.get(sessionId);
    if (fitPoll) {
      clearInterval(fitPoll);
      this.fitPolls.delete(sessionId);
    }
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

    const keyName = keycodeToKeysym(keycode);
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
