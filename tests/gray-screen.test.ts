import { describe, it, expect } from 'vitest';
import { AppStreamer, pickPorts, buildGstArgs } from '../server/streamer.ts';
import { readFileSync } from 'node:fs';

describe('Task 1: Streamer anti-gris', () => {
  it('getEncoderArgs usa HW por defecto y software tras 2 fallos', () => {
    const s = new AppStreamer({ displayNum: 1, width: 1280, height: 720 });
    expect(s.getEncoderArgs()[0]).toBe('vajpegenc');
    (s as any).recordFailure();
    (s as any).recordFailure();
    expect(s.getEncoderArgs()[0]).toBe('avenc_mjpeg');
    s.stop();
  });

  it('pipeline incluye caps explícitas + queue leaky + convert/scale y sin jpegenc', () => {
    const src = readFileSync('server/streamer.ts', 'utf8');
    expect(src).toContain('videoconvert');
    expect(src).toContain('videoscale');
    expect(src).toContain('leaky=downstream');
    expect(src).toContain('max-size-buffers=3');
    expect(src).toContain('format=BGRx');
    expect(src).toContain('framerate=');
    expect(src).toContain('avenc_mjpeg');
    expect(src.includes("'jpegenc'")).toBe(false);
    expect(src.includes('"jpegenc"')).toBe(false);
  });

  it('buildGstArgs genera el pipeline real con caps + queue leaky + encoder (sin spawnear gst)', () => {
    const hw = buildGstArgs({ width: 1280, height: 720, fps: 30, clientName: 'hydra_x', encoderArgs: ['vajpegenc', 'quality=85'] });
    const s = hw.join(' ');
    expect(s).toContain('video/x-raw,format=BGRx,width=1280,height=720,framerate=30/1');
    expect(s).toContain('queue max-size-buffers=3 leaky=downstream');
    expect(s).toContain('videoconvert');
    expect(s).toContain('videoscale');
    expect(s).toContain('vajpegenc');
    expect(s).not.toContain('target-object');
    // orden: caps antes de queue, queue antes de convert/scale, encoder antes de fdsink
    expect(s.indexOf('video/x-raw,format=BGRx')).toBeLessThan(s.indexOf('queue'));
    expect(s.indexOf('leaky=downstream')).toBeLessThan(s.indexOf('videoconvert'));
    expect(s.indexOf('videoscale')).toBeLessThan(s.indexOf('vajpegenc'));
    expect(s.indexOf('vajpegenc')).toBeLessThan(s.indexOf('fdsink'));
    // software + nodeId + impares → target-object, redondeo a par, avenc_mjpeg
    const sw = buildGstArgs({ width: 393, height: 841, fps: 30, pipewireNodeId: 42, clientName: 'hydra_x', encoderArgs: ['avenc_mjpeg', 'quality=85'] });
    const ss = sw.join(' ');
    expect(ss).toContain('target-object=42');
    expect(ss).toContain('width=394');
    expect(ss).toContain('height=842');
    expect(ss).toContain('avenc_mjpeg');
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
