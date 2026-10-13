import { useEffect, useRef, useState, useCallback } from 'react';

export function useHydraSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const onVideoChunkRef = useRef<((chunk: Uint8Array) => void) | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log('[hydra-client] Conectado al servidor WebSocket');
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('[hydra-client] Conexión cerrada');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') {
            const rtt = Date.now() - msg.timestamp;
            setLatency(Math.max(1, Math.round(rtt)));
          }
        } catch {
          // Ignore
        }
      } else if (event.data instanceof ArrayBuffer) {
        if (onVideoChunkRef.current) {
          onVideoChunkRef.current(new Uint8Array(event.data));
        }
      }
    };

    // Ping interval for RTT latency measurement
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 2000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, []);

  const sendTouch = useCallback((slot: number, trackingId: number, x: number, y: number, pressure = 128) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const buf = new Uint8Array(9);
    const view = new DataView(buf.buffer);
    view.setUint8(0, 0x01);
    view.setUint8(1, Math.max(0, Math.min(9, slot)));
    view.setInt16(2, trackingId, true);
    view.setUint16(4, Math.max(0, Math.round(x)), true);
    view.setUint16(6, Math.max(0, Math.round(y)), true);
    view.setUint8(8, Math.max(0, Math.min(255, pressure)));

    wsRef.current.send(buf);
  }, []);

  const sendSync = useCallback((activeCount: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const buf = new Uint8Array(2);
    buf[0] = 0x02;
    buf[1] = activeCount;

    wsRef.current.send(buf);
  }, []);

  const sendKey = useCallback((keyCode: number, isDown: boolean) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setUint8(0, 0x03);
    view.setUint16(1, keyCode, true);
    view.setUint8(3, isDown ? 1 : 0);

    wsRef.current.send(buf);
  }, []);

  const attachStream = useCallback((sessionId: string, width: number, height: number, fps = 60) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'attach_stream',
      sessionId,
      width,
      height,
      fps
    }));
  }, []);

  const setOnVideoChunk = useCallback((callback: ((chunk: Uint8Array) => void) | null) => {
    onVideoChunkRef.current = callback;
  }, []);

  return {
    isConnected,
    latency,
    sendTouch,
    sendSync,
    sendKey,
    attachStream,
    setOnVideoChunk,
  };
}
