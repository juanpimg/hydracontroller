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
  pipewireNodeId?: number;
  startedAt: number;
}

export class VirtualDisplayManager extends EventEmitter {
  private activeSessions = new Map<string, { session: RunningSession; proc: ChildProcess }>();
  private nextDisplay = 10;

  constructor() {
    super();
  }

  public getSessions(): RunningSession[] {
    return Array.from(this.activeSessions.values()).map(v => v.session);
  }

  public getSession(id: string): RunningSession | undefined {
    return this.activeSessions.get(id)?.session;
  }

  public launchApp(appId: string, appName: string, execCmd: string, width = 720, height = 1280): RunningSession {
    const sessionId = `session_${Date.now()}`;
    const displayNum = this.nextDisplay++;

    console.log(`[hydra-display] Starting virtual session ${sessionId} for ${appName} (${width}x${height}) on :${displayNum}`);

    // Build gamescope arguments
    // Gamescope runs nested Wayland / Xwayland headless session
    const args = [
      '-W', String(width),
      '-H', String(height),
      '-w', String(width),
      '-h', String(height),
      '-r', '60',
      '--backend', 'headless',
      '--expose-wayland',
      '--',
      'sh', '-c', execCmd,
    ];

    const env = {
      ...process.env,
      DISPLAY: `:${displayNum}`,
      GDK_BACKEND: 'x11,wayland',
      QT_QPA_PLATFORM: 'xcb;wayland',
    };

    const proc = spawn('gamescope', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    const session: RunningSession = {
      id: sessionId,
      appId,
      appName,
      pid: proc.pid,
      width,
      height,
      displayNum,
      startedAt: Date.now(),
    };

    // Monitor gamescope output to parse pipewire node ID
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Look for: pipewire: stream available on node ID: <id>
      const match = text.match(/pipewire: stream available on node ID:\s*(\d+)/);
      if (match) {
        session.pipewireNodeId = parseInt(match[1], 10);
        console.log(`[hydra-display] Detected PipeWire stream node ${session.pipewireNodeId} for ${appName}`);
        this.emit('pipewire-node', session);
      }
    });

    proc.on('exit', (code) => {
      console.log(`[hydra-display] Session ${sessionId} (${appName}) closed with code ${code}`);
      this.activeSessions.delete(sessionId);
      this.emit('session-closed', sessionId);
    });

    this.activeSessions.set(sessionId, { session, proc });
    this.emit('session-started', session);

    return session;
  }

  public terminateSession(sessionId: string): boolean {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;

    console.log(`[hydra-display] Terminating session ${sessionId}`);
    entry.proc.kill('SIGTERM');
    this.activeSessions.delete(sessionId);
    return true;
  }

  public terminateAll() {
    for (const [id, entry] of this.activeSessions.entries()) {
      entry.proc.kill('SIGTERM');
    }
    this.activeSessions.clear();
  }
}
