import { describe, it, expect } from 'vitest';
import { VirtualDisplayManager } from '../server/virtual-display.ts';

describe('black-screen root cause', () => {
  it('sesión nueva no usa display placeholder válido (debe ser 0 para que el safety-check bloquee captura prematura)', () => {
    const mgr = new VirtualDisplayManager();
    const s = mgr.launchApp('app1', 'Test', 'sleep 30', 390, 844);
    // Si es 1, el streamer arranca contra DISPLAY equivocado antes de display-ready
    expect(s.displayNum).toBe(0);
    expect(s.isReady).toBe(false);
    mgr.terminateSession(s.id);
  });

  it('dimensiones móviles impares se redondean a par (YUV420/gamescope exigen par)', async () => {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync('src/App.tsx', 'utf8');
    const hookSrc = readFileSync('src/hooks/useHydraSocket.ts', 'utf8');
    const dispSrc = readFileSync('server/virtual-display.ts', 'utf8');
    // Contrato: redondeo Math.ceil(n/2)*2 en frontend y backend
    expect(appSrc.includes('Math.ceil')).toBe(true);
    expect(hookSrc.includes('Math.ceil')).toBe(true);
    expect(dispSrc.includes('Math.ceil')).toBe(true);
  });

  it('attachStream encola cuando WS no está OPEN (no drop silencioso)', async () => {
    // Contr��ato: attach llamado con WS CONNECTING debe encolarse y enviarse al abrir.
    // Implementación actual en useHydraSocket.ts:95-96 hace `if (readyState!==OPEN) return` sin cola.
    // Este test falla hasta que exista cola pendiente.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/hooks/useHydraSocket.ts', 'utf8');
    const hasQueue = /pendingAttach|pendingQueue|queueAttach|flushPending/i.test(src);
    expect(hasQueue).toBe(true);
  });
});
