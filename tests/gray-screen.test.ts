import { describe, it, expect } from 'vitest';
import { AppStreamer, pickPorts, buildGstArgs } from '../server/streamer.ts';
import { VirtualDisplayManager } from '../server/virtual-display.ts';
import { readFileSync } from 'node:fs';

describe('Task 1: Streamer anti-gris', () => {
  it('getEncoderArgs usa software por defecto (vajpegenc cuelga sin codificar en muchos hosts) y HW solo con USE_VAAPI=1', () => {
    const s = new AppStreamer({ displayNum: 1, width: 1280, height: 720 });
    expect(s.getEncoderArgs()[0]).toBe('avenc_mjpeg');
    s.stop();
  });

  it('pipeline incluye queue leaky + convert/scale y sin jpegenc (caps loose, sin pinar formato)', () => {
    const src = readFileSync('server/streamer.ts', 'utf8');
    expect(src).toContain('videoconvert');
    expect(src).toContain('videoscale');
    expect(src).toContain('leaky=downstream');
    expect(src).toContain('max-size-buffers=3');
    expect(src).toContain('avenc_mjpeg');
    expect(src.includes("'jpegenc'")).toBe(false);
    expect(src.includes('"jpegenc"')).toBe(false);
  });

  it('buildGstArgs pipeline mínimo probado en vivo (187KB con probe2): sin videoscale ni framerate pineado que stallean la negociación', () => {
    const hw = buildGstArgs({ width: 1280, height: 720, fps: 30, clientName: 'hydra_x', encoderArgs: ['vajpegenc', 'quality=85'] });
    const s = hw.join(' ');
    expect(s).toContain('video/x-raw');
    expect(s).not.toContain('format=BGRx');
    expect(s).not.toContain('width=1280');
    expect(s).not.toContain('target-object');
    expect(s).not.toContain('videoscale');
    expect(s).not.toContain('framerate=');
    expect(s).toContain('queue max-size-buffers=3 leaky=downstream');
    expect(s).toContain('videoconvert');
    expect(s).toContain('vajpegenc');
    // orden: caps loose antes de queue, queue antes de convert, encoder antes de fdsink
    expect(s.indexOf('video/x-raw')).toBeLessThan(s.indexOf('queue'));
    expect(s.indexOf('leaky=downstream')).toBeLessThan(s.indexOf('videoconvert'));
    expect(s.indexOf('videoconvert')).toBeLessThan(s.indexOf('vajpegenc'));
    expect(s.indexOf('vajpegenc')).toBeLessThan(s.indexOf('fdsink'));
    // software → sin target-object, avenc_mjpeg sin quality (el link va por pw-link explícito)
    const sw = buildGstArgs({ width: 393, height: 841, fps: 30, pipewireNodeId: 42, clientName: 'hydra_x', encoderArgs: ['avenc_mjpeg'] });
    const ss = sw.join(' ');
    expect(ss).not.toContain('target-object');
    expect(ss).toContain('avenc_mjpeg');
    expect(ss).not.toContain('quality');
  });

  it('startProcess cablea getEncoderArgs al pipeline (sin spawnear gst)', () => {
    const src = readFileSync('server/streamer.ts', 'utf8');
    expect(src).toContain('this.getEncoderArgs()');
    expect(src).toContain('buildGstArgs(');
    expect(src).toMatch(/buildGstArgs\(\{[\s\S]*?encoderArgs/);
  });

  it('descarta frames rotos <800B (mismo umbral que Task3)', () => {
    const src = readFileSync('server/streamer.ts', 'utf8');
    expect(src).toMatch(/frame\.length\s*<\s*800/);
  });

  it('pickPorts hace break tras primer outPort válido', () => {
    const dump = [
      { id: 10, type: 'PipeWire:Interface:Port', info: { direction: 'output', props: { 'node.id': 42 } } },
      { id: 11, type: 'PipeWire:Interface:Port', info: { direction: 'output', props: { 'node.id': 42 } } },
      { id: 20, type: 'PipeWire:Interface:Port', info: { direction: 'input', props: { 'node.name': 'hydra_x', 'port.alias': 'hydra_x:input_1' } } },
    ];
    const r = pickPorts(dump as any, 42, 'hydra_x');
    expect(r.outPortId).toBe(10);
    expect(r.inPortId).toBe(20);
  });

  it('pickPorts valida node.id y clientName, null si no hay match', () => {
    const dump = [
      { id: 10, type: 'PipeWire:Interface:Port', info: { direction: 'output', props: { 'node.id': 99 } } },
      { id: 20, type: 'PipeWire:Interface:Port', info: { direction: 'input', props: { 'node.name': 'otro', 'port.alias': 'otro:input_1' } } },
    ];
    const r = pickPorts(dump as any, 42, 'hydra_x');
    expect(r.outPortId).toBeNull();
    expect(r.inPortId).toBeNull();
  });
});

describe('Task 2: Virtual-display app real', () => {
  it('isAppAlive: viva tras launch, falsa tras terminate; par + display 0 hasta ready', () => {
    const mgr = new VirtualDisplayManager();
    const s1 = mgr.launchApp('x', 't', 'sleep 30', 390, 844);
    expect(s1.width).toBe(390); // ya par, sin cambio
    expect(s1.height).toBe(844);
    expect(s1.displayNum).toBe(0);
    expect(s1.isReady).toBe(false);
    const s2 = mgr.launchApp('x', 't', 'sleep 30', 393, 841);
    expect(s2.width).toBe(394); // impar → par
    expect(s2.height).toBe(842);
    expect(mgr.isAppAlive(s1.id)).toBe(true);
    expect(mgr.isAppAlive('inexistente')).toBe(false);
    mgr.terminateSession(s1.id);
    expect(mgr.isAppAlive(s1.id)).toBe(false);
    mgr.terminateSession(s2.id);
    expect(mgr.isAppAlive(s2.id)).toBe(false);
  });

  it('lanza error si execCmd vacío antes de spawn', () => {
    const mgr = new VirtualDisplayManager();
    expect(() => mgr.launchApp('x', 't', '', 390, 844)).toThrow();
    expect(() => mgr.launchApp('x', 't', '   ', 390, 844)).toThrow();
  });

  it('escucha stdout además de stderr para Starting Xwayland y enfoca ventana al ready', () => {
    const src = readFileSync('server/virtual-display.ts', 'utf8');
    expect(src).toContain('proc.stdout');
    expect(src).toContain('Starting Xwayland');
    expect(src).toContain('xdotool');
    expect(src).toContain('windowactivate');
    expect(src).toContain('mousemove');
    expect(src).toContain('click');
  });
});

describe('Task 3: frame guard del frontend', () => {
  it('shouldDropFrame descarta <800B, isGrayFrame caza gris por varianza', async () => {
    const { shouldDropFrame, isGrayFrame } = await import('../src/lib/frame-guard.ts');
    expect(shouldDropFrame(100)).toBe(true);
    expect(shouldDropFrame(799)).toBe(true);
    expect(shouldDropFrame(800)).toBe(false);
    expect(shouldDropFrame(5000)).toBe(false);
    expect(isGrayFrame(128, 2)).toBe(true);
    expect(isGrayFrame(15, 45)).toBe(false);
    expect(isGrayFrame(128, 200)).toBe(false);
    expect(isGrayFrame(250, 2)).toBe(false);
  });

  it('StreamView descarta chunk<800 y dropea si está decodificando', () => {
    const src = readFileSync('src/components/StreamView.tsx', 'utf8');
    expect(src).toContain('shouldDropFrame');
    expect(src).toMatch(/decoding/);
    expect(src).toContain('frame-guard');
  });

  it('useHydraSocket acepta Blob y ArrayBuffer', () => {
    const src = readFileSync('src/hooks/useHydraSocket.ts', 'utf8');
    expect(src).toContain('ArrayBuffer');
    expect(src).toContain('Blob');
    expect(src).toContain('arrayBuffer()');
  });
});
