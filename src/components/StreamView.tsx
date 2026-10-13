import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RunningSession } from './RunningTasks.tsx';
import { StreamControls } from './StatusBar.tsx';
import { shouldDropFrame } from '../lib/frame-guard.ts';
import { webKeyToLinuxCode } from '../lib/keymap.ts';
import { canUseFullscreen, isStandaloneDisplay } from '../lib/fullscreen.ts';

interface StreamViewProps {
  session: RunningSession;
  sendTouch: (slot: number, trackingId: number, x: number, y: number, pressure?: number) => void;
  sendSync: (activeCount: number) => void;
  sendKey: (keyCode: number, isDown: boolean) => void;
  attachStream: (sessionId: string, width: number, height: number, fps?: number) => void;
  detachStream?: () => void;
  setOnVideoChunk: (callback: ((chunk: Uint8Array) => void) | null) => void;
  isConnected: boolean;
  onControlsReady: (c: StreamControls | null) => void;
}

export const StreamView: React.FC<StreamViewProps> = ({
  session,
  sendTouch,
  sendSync,
  sendKey,
  attachStream,
  detachStream,
  setOnVideoChunk,
  isConnected,
  onControlsReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  // Active pointer tracking map: pointerId -> slot (0..9)
  const activeSlots = useRef<Map<number, number>>(new Map());

  // Keyboard focus toggle (exposed to the top bar)
  const triggerKeyboard = useCallback(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus();
    }
  }, []);

  // Fullscreen toggle (exposed to the top bar). Standard API first, then the
  // webkit prefix (older Chrome/Safari); warns instead of failing silently
  // like before (iPhone Safari has no Fullscreen API at all).
  const toggleFullscreen = useCallback(() => {
    try {
      const doc = document as any;
      const isFull = document.fullscreenElement || doc.webkitFullscreenElement;
      if (!isFull) {
        const el = document.documentElement as any;
        const req =
          el.requestFullscreen?.bind(el) || el.webkitRequestFullscreen?.bind(el);
        if (!req) {
          console.warn('[hydra] Pantalla completa no soportada en este navegador');
          return;
        }
        Promise.resolve(req()).catch((err) =>
          console.warn('[hydra] No se pudo abrir pantalla completa:', err)
        );
      } else {
        const exit =
          document.exitFullscreen?.bind(document) || doc.webkitExitFullscreen?.bind(document);
        if (!exit) return;
        Promise.resolve(exit()).catch((err) =>
          console.warn('[hydra] No se pudo salir de pantalla completa:', err)
        );
      }
    } catch (err) {
      console.warn('[hydra] Pantalla completa no disponible:', err);
    }
  }, []);

  // Publish stream controls to the top bar; clear on unmount.
  // The fullscreen button is only offered when it can actually do something.
  const [fullscreenOk] = useState(() => {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return canUseFullscreen(
      doc.fullscreenEnabled === true,
      doc.webkitFullscreenEnabled === true,
      isStandaloneDisplay()
    );
  });

  // Publish stream controls to the top bar; clear on unmount
  useEffect(() => {
    onControlsReady({
      openKeyboard: triggerKeyboard,
      toggleFullscreen: fullscreenOk ? toggleFullscreen : undefined,
    });
    return () => onControlsReady(null);
  }, [onControlsReady, triggerKeyboard, toggleFullscreen, fullscreenOk]);

  // Registra el renderer de video (callback antes que attach para no perder frames)
  useEffect(() => {
    let isDestroyed = false;
    let latestSeq = 0;
    let latestRenderedSeq = 0;
    let decoding = false;

    setOnVideoChunk((chunk) => {
      if (isDestroyed) return;
      // Descarta fragmentos rotos (<800B) antes de crear el Blob
      if (shouldDropFrame(chunk.byteLength)) return;
      // Drop-if-busy: en móvil lento no se apilan decodificaciones
      if (decoding) return;
      decoding = true;
      const seq = ++latestSeq;

      const drawCanvas = canvasRef.current;
      const drawCtx = drawCanvas?.getContext('2d');
      if (!drawCanvas || !drawCtx) {
        decoding = false;
        return;
      }

      const blob = new Blob([chunk as unknown as BlobPart], { type: 'image/jpeg' });
      if (typeof window.createImageBitmap === 'function') {
        window.createImageBitmap(blob)
          .then((bitmap) => {
            if (!isDestroyed && seq >= latestRenderedSeq) {
              latestRenderedSeq = seq;
              drawCtx.drawImage(bitmap, 0, 0, drawCanvas.width, drawCanvas.height);
              setHasVideo(true);
            }
            bitmap.close();
            decoding = false;
          })
          .catch(() => {
            decoding = false;
          });
      } else {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!isDestroyed && seq >= latestRenderedSeq) {
            latestRenderedSeq = seq;
            drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
            setHasVideo(true);
          }
          URL.revokeObjectURL(url);
          decoding = false;
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          decoding = false;
        };
        img.src = url;
      }
    });

    return () => {
      isDestroyed = true;
      setOnVideoChunk(null);
    };
  }, [setOnVideoChunk]);

  // Attach al stream cuando hay conexión (reintenta al reconectar, evita race CONNECTING)
  useEffect(() => {
    if (!isConnected) return;
    const width = Math.ceil((session.width || 720) / 2) * 2;
    const height = Math.ceil((session.height || 1280) / 2) * 2;
    setHasVideo(false);
    attachStream(session.id, width, height, 30);

    return () => {
      if (detachStream) {
        detachStream();
      }
    };
  }, [session.id, isConnected, attachStream, detachStream]);

  // Helper to map pointer events to virtual display coordinates accounting for object-contain letterboxing
  const getTouchCoords = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const sessWidth = session.width || 720;
    const sessHeight = session.height || 1280;

    const canvasAspect = sessWidth / sessHeight;
    const rectAspect = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (rectAspect > canvasAspect) {
      // Letterboxed on left and right
      renderWidth = rect.height * canvasAspect;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      // Letterboxed on top and bottom
      renderHeight = rect.width / canvasAspect;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const scaleX = sessWidth / renderWidth;
    const scaleY = sessHeight / renderHeight;

    const x = Math.max(0, Math.min(sessWidth, (e.clientX - rect.left - offsetX) * scaleX));
    const y = Math.max(0, Math.min(sessHeight, (e.clientY - rect.top - offsetY) * scaleY));

    return { x, y };
  }, [session.width, session.height]);

  // Multitouch Pointer Handlers mapped directly to Linux EV_ABS touchscreen
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const coords = getTouchCoords(e);
    if (!coords) return;

    let slot = activeSlots.current.get(e.pointerId);
    if (slot === undefined) {
      // Find lowest free slot (0..9)
      const usedSlots = new Set(activeSlots.current.values());
      for (let s = 0; s < 10; s++) {
        if (!usedSlots.has(s)) {
          slot = s;
          break;
        }
      }
      if (slot === undefined) slot = 0;
      activeSlots.current.set(e.pointerId, slot);
    }

    const pressure = Math.round((e.pressure || 0.5) * 255);
    sendTouch(slot, e.pointerId % 32767, coords.x, coords.y, pressure);
    sendSync(activeSlots.current.size);
  }, [getTouchCoords, sendTouch, sendSync]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const slot = activeSlots.current.get(e.pointerId);
    if (slot === undefined) return;

    const coords = getTouchCoords(e);
    if (!coords) return;

    const pressure = Math.round((e.pressure || 0.5) * 255);
    sendTouch(slot, e.pointerId % 32767, coords.x, coords.y, pressure);
    sendSync(activeSlots.current.size);
  }, [getTouchCoords, sendTouch, sendSync]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const slot = activeSlots.current.get(e.pointerId);
    if (slot !== undefined) {
      sendTouch(slot, -1, 0, 0, 0); // Release tracking ID
      activeSlots.current.delete(e.pointerId);
      sendSync(activeSlots.current.size);
    }
  }, [sendTouch, sendSync]);

  // Mobile Native Keyboard Handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const code = webKeyToLinuxCode(e.key);
    if (code > 0) {
      sendKey(code, true);
      setTimeout(() => sendKey(code, false), 50);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden touch-none select-none"
    >
      {/* Hidden input to open native Android/iOS keyboard */}
      <input
        ref={hiddenInputRef}
        type="text"
        onKeyDown={handleKeyDown}
        className="absolute opacity-0 pointer-events-none w-0 h-0 -top-10"
        autoCapitalize="none"
        autoComplete="off"
      />

      {/* Touch Surface Canvas */}
      <canvas
        ref={canvasRef}
        width={Math.ceil((session.width || 720) / 2) * 2}
        height={Math.ceil((session.height || 1280) / 2) * 2}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full h-full object-contain cursor-crosshair touch-none"
      />

      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <span className="text-slate-500 text-sm">
            {!isConnected ? 'Conectando…' : 'Iniciando app…'}
          </span>
        </div>
      )}
    </div>
  );
};
