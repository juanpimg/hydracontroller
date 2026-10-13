import { describe, it, expect } from 'vitest';
import { AppStreamer, pickPorts } from '../server/streamer.ts';
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
