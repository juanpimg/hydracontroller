import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Keyboard, Maximize, Minimize, ArrowLeft, X } from 'lucide-react';
import { RunningSession } from './RunningTasks.tsx';

interface StreamViewProps {
  session: RunningSession;
  onClose: () => void;
  onBack: () => void;
  sendTouch: (slot: number, trackingId: number, x: number, y: number, pressure?: number) => void;
  sendSync: (activeCount: number) => void;
  sendKey: (keyCode: number, isDown: boolean) => void;
  attachStream: (sessionId: string, width: number, height: number, fps?: number) => void;
  setOnVideoChunk: (callback: ((chunk: Uint8Array) => void) | null) => void;
}

export const StreamView: React.FC<StreamViewProps> = ({
  session,
  onClose,
  onBack,
  sendTouch,
  sendSync,
  sendKey,
  attachStream,
  setOnVideoChunk,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls] = useState(true);

  // Active pointer tracking map: pointerId -> slot (0..9)
  const activeSlots = useRef<Map<number, number>>(new Map());

  // Keyboard focus toggle
  const triggerKeyboard = () => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus();
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Connect stream when mounted
  useEffect(() => {
    const width = session.width || 720;
    const height = session.height || 1280;
    attachStream(session.id, width, height, 60);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // VideoDecoder for ultra-low latency WebCodecs
    let decoder: any = null;
    if (typeof (window as any).VideoDecoder !== 'undefined') {
      try {
        decoder = new (window as any).VideoDecoder({
          output: (frame: any) => {
            if (ctx) {
              ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
            }
            frame.close();
          },
          error: (e: any) => {
            console.warn('[hydra-decoder] VideoDecoder error:', e);
          },
        });

        decoder.configure({
          codec: 'avc1.42001f', // Baseline H.264
          hardwareAcceleration: 'prefer-hardware',
          optimizeForLatency: true,
        });

        setOnVideoChunk((chunk) => {
          if (decoder && decoder.state === 'configured') {
            try {
              const encChunk = new (window as any).EncodedVideoChunk({
                type: 'key',
                timestamp: performance.now() * 1000,
                data: chunk,
              });
              decoder.decode(encChunk);
            } catch {
              // Ignore frame errors
            }
          }
        });
      } catch (err) {
        console.warn('[hydra-decoder] Failed to init WebCodecs VideoDecoder:', err);
      }
    }

    return () => {
      setOnVideoChunk(null);
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {}
      }
    };
  }, [session, attachStream, setOnVideoChunk]);

  // Multitouch Pointer Handlers mapped directly to Linux EV_ABS touchscreen
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = session.width / rect.width;
    const scaleY = session.height / rect.height;

    const x = Math.max(0, Math.min(session.width, (e.clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(session.height, (e.clientY - rect.top) * scaleY));

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
    sendTouch(slot, e.pointerId % 32767, x, y, pressure);
    sendSync(activeSlots.current.size);
  }, [session, sendTouch, sendSync]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const slot = activeSlots.current.get(e.pointerId);
    if (slot === undefined) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = session.width / rect.width;
    const scaleY = session.height / rect.height;

    const x = Math.max(0, Math.min(session.width, (e.clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(session.height, (e.clientY - rect.top) * scaleY));

    const pressure = Math.round((e.pressure || 0.5) * 255);
    sendTouch(slot, e.pointerId % 32767, x, y, pressure);
    sendSync(activeSlots.current.size);
  }, [session, sendTouch, sendSync]);

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
    // Map web key event to Linux input_event keycode
    // Common mappings: Backspace=14, Enter=28, Space=57, etc.
    let code = 0;
    if (e.key === 'Backspace') code = 14;
    else if (e.key === 'Enter') code = 28;
    else if (e.key === ' ') code = 57;
    else if (e.key === 'Escape') code = 1;
    else if (e.key === 'Tab') code = 15;
    else {
      // Basic ASCII letter/number
      const charCode = e.key.toUpperCase().charCodeAt(0);
      if (charCode >= 65 && charCode <= 90) {
        // A..Z keycodes 30..38, etc.
        const letters = 'QWERTYUIOPASDFGHJKLZXCVBNM';
        const keycodes = [16,17,18,19,20,21,22,23,24,25,30,31,32,33,34,35,36,37,38,44,45,46,47,48,49,50];
        const idx = letters.indexOf(e.key.toUpperCase());
        if (idx !== -1) code = keycodes[idx];
      }
    }

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
        width={session.width}
        height={session.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full h-full object-contain cursor-crosshair touch-none"
      />

      {/* Floating Action Controls */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-900/90 backdrop-blur-md border border-slate-700/60 shadow-2xl transition-opacity duration-300 z-50 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Back to Launcher */}
        <button
          onClick={onBack}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title="Volver al lanzador"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Keyboard Trigger */}
        <button
          onClick={triggerKeyboard}
          className="p-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
          title="Abrir teclado nativo"
        >
          <Keyboard className="w-5 h-5" />
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullscreen}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title="Pantalla completa"
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>

        {/* Close App Session */}
        <button
          onClick={onClose}
          className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30 transition-colors"
          title="Cerrar sesión"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
