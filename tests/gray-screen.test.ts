import { describe, it, expect } from 'vitest';
import { AppStreamer, pickPorts, buildGstArgs } from '../server/streamer.ts';
import { VirtualDisplayManager, classifyTouchEvent, pickMainWindow, buildFitCommands } from '../server/virtual-display.ts';
import { readFileSync } from 'node:fs';

describe('Task 1: Streamer anti-gris', () => {
  it('getEncoderArgs usa software por defecto con quantizer constante (CBR 200kbps/qmax=31 = bloques)', () => {
    const s = new AppStreamer({ displayNum: 1, width: 1280, height: 720 });
    const args = s.getEncoderArgs();
    expect(args[0]).toBe('avenc_mjpeg');
    expect(args.join(' ')).toContain('pass=quant');
    expect(args.join(' ')).toContain('quantizer=2');
    expect(args.join(' ')).not.toContain('quality');
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

  it('classifyTouchEvent distingue down/move/up por estado del slot (el move llegaba como down repetido)', () => {
    expect(classifyTouchEvent(undefined, -1, 0)).toBe('up');
    expect(classifyTouchEvent(5, -1, 128)).toBe('up');
    expect(classifyTouchEvent(5, 5, 0)).toBe('up');
    expect(classifyTouchEvent(undefined, 1234, 128)).toBe('down');
    expect(classifyTouchEvent(-1, 1234, 128)).toBe('down');
    expect(classifyTouchEvent(999, 1234, 128)).toBe('down');
    expect(classifyTouchEvent(1234, 1234, 128)).toBe('move');
    expect(classifyTouchEvent(0, 0, 200)).toBe('move');
  });

  it('sendPointerEvent no inyecta en :0 cuando el display aún no está asignado', () => {
    const src = readFileSync('server/virtual-display.ts', 'utf8');
    expect(src).toMatch(/displayNum\s*<=\s*0/);
  });

  it('las apps se fuerzan a X11 para que xdotool las alcance (Wayland ignora XTEST)', () => {
    const src = readFileSync('server/virtual-display.ts', 'utf8');
    expect(src).toContain('GDK_BACKEND');
    expect(src).toContain('QT_QPA_PLATFORM');
  });

  it('pickMainWindow elige la ventana visible de mayor área (ignora root/tooltips)', () => {
    expect(pickMainWindow([])).toBeNull();
    expect(pickMainWindow([
      { id: '1', w: 720, h: 1280 },
      { id: '2', w: 640, h: 480 },
      { id: '3', w: 34, h: 25 },
    ])).toBe('1');
    expect(pickMainWindow([{ id: '2', w: 640, h: 480 }])).toBe('2');
  });

  it('buildFitCommands maximiza la ventana al display (mapeo 1:1, sin escalado gamescope)', () => {
    expect(buildFitCommands('5', 720, 1280)).toEqual([
      ['windowsize', '5', '720', '1280'],
      ['windowmove', '5', '0', '0'],
      ['windowraise', '5'],
    ]);
  });

  it('fitAfterReady busca por --class (con --name . no matchea nada: bug silencioso verificado en vivo)', () => {
    const src = readFileSync('server/virtual-display.ts', 'utf8');
    expect(src).toContain('fitAfterReady');
    expect(src).not.toMatch(/search', '--onlyvisible', '--name', '\.'/);
  });

  it('el input de sesión NO se reenvía a uinput del host (fuga al escritorio real)', () => {
    const src = readFileSync('server/index.ts', 'utf8');
    expect(src).not.toContain('uinput.sendTouchEvent');
    expect(src).not.toContain('uinput.sendSync');
    expect(src).not.toContain('uinput.sendKeyEvent');
  });

  it('attach_stream re-ajusta ventanas al display (la ventana mapea tarde, display-ready llega pronto)', () => {
    const src = readFileSync('server/index.ts', 'utf8');
    expect(src).toContain('fitSessionWindows');
  });

  it('attach provoca un micro-movimiento (nodo idle sin damage = 0 frames para siempre)', () => {
    const src = readFileSync('server/index.ts', 'utf8');
    expect(src).toMatch(/sendPointerEvent\(sessionId, 'move'/);
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
