import { spawn, ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import type { WebSocket } from 'ws';

export interface StreamerOptions {
  displayNum: number;
  width: number;
  height: number;
  fps?: number;
  pipewireNodeId?: number;
  audioToClient?: boolean;
}

export class AppStreamer extends EventEmitter {
  private ffmpegProc: ChildProcess | null = null;
  private isStreaming = false;

  constructor(private options: StreamerOptions) {
    super();
  }

  public startStreaming(ws: WebSocket) {
    if (this.isStreaming) return;
    this.isStreaming = true;

    const { displayNum, width, height, fps = 60 } = this.options;

    console.log(`[hydra-streamer] Starting zero-latency H.264 stream for DISPLAY=:${displayNum} (${width}x${height}@${fps}fps)`);

    // FFmpeg pipeline optimized for ultra-low latency real-time streaming
    // -f x11grab captures the gamescope X11 surface directly
    // Uses ultrafast zerolatency tune, outputting Annex-B H.264 bitstream
    const args = [
      '-f', 'x11grab',
      '-draw_mouse', '0',
      '-video_size', `${width}x${height}`,
      '-framerate', String(fps),
      '-i', `:${displayNum}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-b:v', '3500k',
      '-maxrate', '5000k',
      '-bufsize', '500k',
      '-f', 'h264',
      'pipe:1',
    ];

    try {
      this.ffmpegProc = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.ffmpegProc.stdout?.on('data', (chunk: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(chunk, { binary: true });
        }
      });

      this.ffmpegProc.stderr?.on('data', (errData: Buffer) => {
        // Can inspect ffmpeg logs if debugging is needed
        const msg = errData.toString();
        if (msg.includes('Error') || msg.includes('fatal')) {
          console.warn('[hydra-streamer] FFmpeg warning:', msg.trim());
        }
      });

      this.ffmpegProc.on('exit', (code) => {
        console.log(`[hydra-streamer] FFmpeg exited with code ${code}`);
        this.isStreaming = false;
        this.ffmpegProc = null;
      });
    } catch (err) {
      console.error('[hydra-streamer] Error launching streamer:', err);
      this.isStreaming = false;
    }
  }

  public stop() {
    if (this.ffmpegProc) {
      this.ffmpegProc.kill('SIGTERM');
      this.ffmpegProc = null;
    }
    this.isStreaming = false;
  }
}
