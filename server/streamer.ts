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

const SOI_MARKER = Buffer.from([0xff, 0xd8]);
const EOI_MARKER = Buffer.from([0xff, 0xd9]);

export function pickPorts(
  dump: Array<any>,
  nodeId: number,
  clientName: string,
): { outPortId: number | null; inPortId: number | null } {
  let outPortId: number | null = null;
  for (const item of dump) {
    if (item?.type !== 'PipeWire:Interface:Port') continue;
    if (item.info?.direction === 'output' && item.info?.props?.['node.id'] === nodeId) {
      outPortId = item.id;
      break;
    }
  }
  let inPortId: number | null = null;
  for (const item of dump) {
    if (item?.type !== 'PipeWire:Interface:Port') continue;
    if (item.info?.direction !== 'input') continue;
    const pProps = item.info?.props;
    if (pProps?.['node.name'] === clientName || (typeof pProps?.['port.alias'] === 'string' && pProps['port.alias'].startsWith(clientName))) {
      inPortId = item.id;
      break;
    }
  }
  return { outPortId, inPortId };
}

export interface GstArgsOptions {
  width: number;
  height: number;
  fps?: number;
  pipewireNodeId?: number;
  clientName: string;
  encoderArgs: string[];
}

export function buildGstArgs(opts: GstArgsOptions): string[] {
  // Pipeline mínimo probado en vivo (probe2: 187KB MJPEG reales).
  // Sin videoscale ni framerate pineado: ambos stalleaban la negociación
  // (0 frames con link OK). Sin target-object con node-id (propiedad de
  // portal serial, no de node id → sin fuente). El link va por pw-link
  // explícito (pickPorts + tryLink).
  return [
    'pipewiresrc',
    'autoconnect=false',
    `client-name=${opts.clientName}`,
    'keepalive-time=1000',
    '!',
    'video/x-raw',
    '!',
    'queue',
    'max-size-buffers=3',
    'leaky=downstream',
    '!',
    'videoconvert',
    '!',
    ...opts.encoderArgs,
    '!',
    'fdsink',
    'fd=1',
  ];
}

export class AppStreamer extends EventEmitter {
  private streamProc: ChildProcess | null = null;
  private isStreaming = false;
  private clients = new Set<WebSocket>();
  private isStopping = false;
  private restartTimeout: NodeJS.Timeout | null = null;
  private pipewireFailures = 0;
  // vajpegenc (VAAPI) cuelga sin codificar en muchos hosts (CRITICAL denom!=0,
  // 378B y stall en vez de exit → el fallback por exit jamás salta). Por eso
  // el default es software; HW solo con USE_VAAPI=1 explícito.
  private useSoftwareEncoder = process.env.USE_VAAPI === '1' ? false : true;

  constructor(private options: StreamerOptions) {
    super();
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public getEncoderArgs(): string[] {
    // avenc_mjpeg NO tiene propiedad quality (solo qmin/qmax) → pasarla mata gst al instante
    return this.useSoftwareEncoder
      ? ['avenc_mjpeg']
      : ['vajpegenc', 'quality=85'];
  }

  private recordFailure(): void {
    this.pipewireFailures++;
    if (this.pipewireFailures >= 2 && !this.useSoftwareEncoder) {
      console.warn('[hydra-streamer] Pipeline failed, switching to software avenc_mjpeg');
      this.useSoftwareEncoder = true;
      if (this.options.pipewireNodeId) {
        this.options.pipewireNodeId = undefined;
      }
    }
  }

  public updateDisplayNum(displayNum: number) {
    const prevDisplay = this.options.displayNum;
    this.options.displayNum = displayNum;
    if (prevDisplay !== displayNum) {
      console.log(`[hydra-streamer] Display number updated to :${displayNum}, restarting stream`);
      this.restartStream();
    }
  }

  public updatePipewireNodeId(pipewireNodeId: number) {
    const prevNodeId = this.options.pipewireNodeId;
    this.options.pipewireNodeId = pipewireNodeId;
    this.pipewireFailures = 0;
    // Si el encoder HW falló antes pero ahora hay nodo nuevo, reintenta HW una vez
    // solo cuando HW es opt-in (USE_VAAPI=1); si no, quédate en software.
    if (this.useSoftwareEncoder && prevNodeId !== pipewireNodeId && process.env.USE_VAAPI === '1') {
      this.useSoftwareEncoder = false;
    }
    // If we received a new or updated PipeWire node ID while streaming,
    // switch immediately to the PipeWire pipeline
    if (this.isStreaming && prevNodeId !== pipewireNodeId) {
      console.log(`[hydra-streamer] Upgrading active stream to PipeWire node ${pipewireNodeId}`);
      this.restartStream();
    }
  }

  public addClient(ws: WebSocket) {
    this.clients.add(ws);

    if (!this.isStreaming) {
      this.startProcess();
    }
  }

  public removeClient(ws: WebSocket) {
    this.clients.delete(ws);
    if (this.clients.size === 0) {
      this.stop();
    }
  }

  // Backwards compatibility for existing single-client callers
  public startStreaming(ws: WebSocket) {
    this.addClient(ws);
  }

  private killProcess(proc: ChildProcess | null) {
    if (!proc) return;
    try {
      proc.removeAllListeners('exit');
      proc.removeAllListeners('error');
      proc.kill('SIGTERM');
      const forceTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, 1000);
      proc.once('exit', () => clearTimeout(forceTimer));
    } catch {}
  }

  private restartStream() {
    if (this.streamProc) {
      this.killProcess(this.streamProc);
      this.streamProc = null;
    }
    this.isStreaming = false;
    if (this.clients.size > 0 && !this.isStopping) {
      this.startProcess();
    }
  }

  private startProcess() {
    if (this.isStreaming || this.isStopping) return;
    this.isStreaming = true;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    const { displayNum, width: rawW, height: rawH, fps = 30 } = this.options;
    // Redondeo defensivo a par (YUV420 lo exige; el móvil puede mandar impares)
    const width = Math.ceil(rawW / 2) * 2;
    const height = Math.ceil(rawH / 2) * 2;

    // Strict safety check: Never capture from host DISPLAY (:0)
    if (!displayNum || displayNum <= 0) {
      console.log(`[hydra-streamer] Waiting for isolated DISPLAY to be assigned before starting capture...`);
      this.isStreaming = false;
      return;
    }

    console.log(`[hydra-streamer] Starting isolated virtual display stream for gamescope (${width}x${height}@${fps}fps)`);

    const clientName = `hydra_stream_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const encoderArgs = this.getEncoderArgs();
    if (this.useSoftwareEncoder) {
      console.log('[hydra-streamer] Using software MJPEG encoder (avenc_mjpeg) after VAAPI failures');
    }

    const gstArgs = buildGstArgs({
      width: rawW,
      height: rawH,
      fps,
      pipewireNodeId: this.options.pipewireNodeId,
      clientName,
      encoderArgs,
    });

    const proc = spawn('gst-launch-1.0', gstArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const currentProc = proc;
    this.streamProc = proc;

    // As soon as the gstreamer pipeline is created, link gamescope to this client's input port
    let linkRetries = 0;
    const tryLink = () => {
      if (this.streamProc !== currentProc || !this.isStreaming) return;

      const retry = () => {
        if (linkRetries < 25 && this.streamProc === currentProc) {
          linkRetries++;
          setTimeout(tryLink, 200);
        }
      };

      const targetNodeId = this.options.pipewireNodeId;
      if (targetNodeId) {
        // Query pw-dump to find the exact port for targetNodeId and clientName
        const dumpProc = spawn('pw-dump', [], { stdio: ['ignore', 'pipe', 'ignore'] });
        let dumpBuf = '';
        dumpProc.stdout.on('data', (d) => { dumpBuf += d.toString(); });
        dumpProc.on('close', (code) => {
          if (code === 0 && this.streamProc === currentProc) {
            try {
              const data = JSON.parse(dumpBuf);
              const { outPortId, inPortId } = pickPorts(data, targetNodeId, clientName);

              if (outPortId && inPortId) {
                const linkProc = spawn('pw-link', [String(outPortId), String(inPortId)]);
                linkProc.on('exit', (lCode) => {
                  if (lCode === 0) {
                    console.log(`[hydra-streamer] Successfully linked node ${targetNodeId} port ${outPortId} -> ${clientName} port ${inPortId}`);
                    return;
                  }
                  retry();
                });
                return;
              }
            } catch {}
          }
          retry();
        });
        return;
      }

      // Fallback: connect by name
      const linkProc = spawn('pw-link', ['gamescope:capture_1', `${clientName}:input_1`]);
      linkProc.on('exit', (linkCode) => {
        if (linkCode === 0) {
          console.log(`[hydra-streamer] Successfully linked gamescope:capture_1 -> ${clientName}:input_1`);
        } else {
          retry();
        }
      });
    };
    setTimeout(tryLink, 300);

    let buffer = Buffer.alloc(0);

    proc.stdout?.on('data', (chunk: Buffer) => {
      // Ignore output if this process has been superseded
      if (this.streamProc !== currentProc) return;

      buffer = Buffer.concat([buffer, chunk]);

      // Extract complete JPEG frames using SOI (0xFF, 0xD8) and EOI (0xFF, 0xD9)
      while (true) {
        const soi = buffer.indexOf(SOI_MARKER);
        if (soi === -1) {
          // No start of image, discard stale bytes
          if (buffer.length > 65536) buffer = Buffer.alloc(0);
          break;
        }

        const eoi = buffer.indexOf(EOI_MARKER, soi + 2);
        if (eoi === -1) {
          // Frame is still being received; keep from soi onwards
          if (soi > 0) buffer = buffer.subarray(soi);
          // Safety cap to prevent buffer explosion on corrupted frames
          if (buffer.length > 4 * 1024 * 1024) buffer = Buffer.alloc(0);
          break;
        }

        // Full frame found
        const frame = buffer.subarray(soi, eoi + 2);
        buffer = buffer.subarray(eoi + 2);

        // JPEG roto (<800B, mismo umbral que Task3): frame gris/incompleto, no publicar
        if (frame.length < 800) continue;

        for (const client of this.clients) {
          if (client.readyState === 1 /* WebSocket.OPEN */) {
            // Drop frames for clients experiencing network congestion or buffer buildup
            // to ensure strict real-time low latency without unbounded RAM growth
            if (client.bufferedAmount > 256 * 1024) {
              continue;
            }
            try {
              client.send(frame, { binary: true });
            } catch (err) {
              console.warn('[hydra-streamer] Error sending frame to client:', err);
            }
          }
        }
      }
    });

    proc.stderr?.on('data', (errData: Buffer) => {
      if (this.streamProc !== currentProc) return;
      const msg = errData.toString();
      // PREROLL / pipeline aún negociando: no es error, seguir esperando frame real
      if (/PREROLL|Setting pipeline to (PAUSED|PLAYING)|buffer size==0/i.test(msg)) return;
      if (/vajpegenc|vaapi/i.test(msg) && /fail|error|cannot|not supported|not-negotiated/i.test(msg)) {
        console.warn('[hydra-streamer] Encoder HW failing (stderr), counting failure:', msg.trim().slice(0, 300));
        this.recordFailure();
        return;
      }
      if (msg.includes('error') || msg.includes('ERROR') || msg.includes('Cannot open display')) {
        console.warn('[hydra-streamer] Stream error notice:', msg.trim());
      }
    });

    proc.on('error', (err) => {
      if (this.streamProc !== currentProc) return;
      console.warn('[hydra-streamer] Stream process spawn error:', err.message);
      this.recordFailure();
      this.isStreaming = false;
      this.streamProc = null;

      if (this.clients.size > 0 && !this.isStopping) {
        this.restartTimeout = setTimeout(() => this.startProcess(), 500);
      }
    });

    proc.on('exit', (code) => {
      // Discard exit events from old superseded processes
      if (this.streamProc !== currentProc) return;

      console.log(`[hydra-streamer] Stream process stopped with code ${code}`);
      this.isStreaming = false;
      this.streamProc = null;

      // Detect persistent PipeWire pipeline failures and fall back to software encoder
      if (code !== 0 && code !== null) {
        this.recordFailure();
      }

      // Auto-restart stream if clients are still attached and stop() was not requested
      if (this.clients.size > 0 && !this.isStopping) {
        console.log('[hydra-streamer] Re-establishing stream for active clients...');
        this.restartTimeout = setTimeout(() => {
          this.startProcess();
        }, 500);
      }
    });
  }

  public stop() {
    this.isStopping = true;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.streamProc) {
      this.killProcess(this.streamProc);
      this.streamProc = null;
    }
    this.isStreaming = false;
    this.clients.clear();
    this.isStopping = false;
  }
}
