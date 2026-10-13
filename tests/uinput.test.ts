import { describe, it, expect, afterAll } from 'vitest';
import { UInputBridge } from '../server/uinput-bridge.ts';

describe('UInput Bridge', () => {
  const bridge = new UInputBridge();

  afterAll(() => {
    bridge.stop();
  });

  it('debe iniciar el puente uinput y enviar eventos táctiles y sincronización sin error', () => {
    const started = bridge.start(1080, 2400);
    expect(started).toBe(true);

    // Enviar evento de toque (slot 0, tracking 1, x 500, y 800)
    expect(() => {
      bridge.sendTouchEvent(0, 1, 500, 800, 128);
      bridge.sendSync(1);
      bridge.sendTouchEvent(0, -1, 0, 0, 0); // Release
      bridge.sendSync(0);
    }).not.toThrow();

    // Enviar evento de tecla
    expect(() => {
      bridge.sendKeyEvent(28, true); // Enter down
      bridge.sendKeyEvent(28, false); // Enter up
    }).not.toThrow();
  });
});
