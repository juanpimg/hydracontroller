import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export class UInputBridge {
  private proc: ChildProcess | null = null;
  private binaryPath: string;

  constructor() {
    this.binaryPath = path.resolve(import.meta.dirname, 'uinput/hydra-uinput');
  }

  public start(maxWidth = 1920, maxHeight = 1080): boolean {
    if (this.proc) return true;

    if (!fs.existsSync(this.binaryPath)) {
      console.warn(`[hydra-uinput] Binary not found at ${this.binaryPath}. Please run npm run build:uinput`);
      return false;
    }

    try {
      this.proc = spawn(this.binaryPath, [String(maxWidth), String(maxHeight)], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });

      this.proc.on('error', (err) => {
        console.error('[hydra-uinput] UInput process error:', err.message);
        this.proc = null;
      });

      this.proc.stdin?.on('error', (err) => {
        console.warn('[hydra-uinput] UInput stdin stream error:', err.message);
      });

      this.proc.on('exit', (code) => {
        console.log(`[hydra-uinput] Process exited with code ${code}`);
        this.proc = null;
      });

      console.log(`[hydra-uinput] Hardware touchscreen bridge active for ${maxWidth}x${maxHeight}`);
      return true;
    } catch (err) {
      console.error('[hydra-uinput] Failed to spawn uinput bridge:', err);
      return false;
    }
  }

  public sendTouchEvent(slot: number, trackingId: number, x: number, y: number, pressure = 128) {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return;

    // Packet type 1: [0x01, slot(1), tracking_id(2 LE), x(2 LE), y(2 LE), pressure(1)] = 9 bytes
    const buf = Buffer.alloc(9);
    buf.writeUInt8(0x01, 0);
    buf.writeUInt8(Math.max(0, Math.min(9, slot)), 1);
    buf.writeInt16LE(trackingId, 2);
    buf.writeUInt16LE(Math.max(0, Math.round(x)), 4);
    buf.writeUInt16LE(Math.max(0, Math.round(y)), 6);
    buf.writeUInt8(Math.max(0, Math.min(255, pressure)), 8);

    this.proc.stdin.write(buf);
  }

  public sendSync(activeCount: number) {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return;

    // Packet type 2: [0x02, active_count(1)] = 2 bytes
    const buf = Buffer.alloc(2);
    buf.writeUInt8(0x02, 0);
    buf.writeUInt8(activeCount, 1);

    this.proc.stdin.write(buf);
  }

  public sendKeyEvent(keyCode: number, isDown: boolean) {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return;

    // Packet type 3: [0x03, keycode(2 LE), state(1)] = 4 bytes
    const buf = Buffer.alloc(4);
    buf.writeUInt8(0x03, 0);
    buf.writeUInt16LE(keyCode, 1);
    buf.writeUInt8(isDown ? 1 : 0, 3);

    this.proc.stdin.write(buf);
  }

  public stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }
}
