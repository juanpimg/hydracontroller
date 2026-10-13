import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

// Ignore self-signed cert for local test
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log('[E2E-TEST] 1. Arrancando servidor Hydra Controller...');
const serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '4096' },
});

serverProc.stdout.on('data', (d) => process.stdout.write(d));
serverProc.stderr.on('data', (d) => process.stderr.write(d));

// Wait for server to start with polling
let serverReady = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const res = await fetch('https://127.0.0.1:4096/api/apps');
    if (res.ok) {
      serverReady = true;
      break;
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
if (!serverReady) {
  throw new Error('Servidor Hydra Controller no respondió a tiempo');
}

try {
  console.log('[E2E-TEST] 2. Consultando aplicaciones...');
  const appsRes = await fetch('https://127.0.0.1:4096/api/apps');
  const apps = await appsRes.json();
  console.log(`[E2E-TEST] Total apps encontradas: ${apps.length}`);

  console.log('[E2E-TEST] 3. Lanzando app de prueba en gamescope...');
  const launchRes = await fetch('https://127.0.0.1:4096/api/sessions/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: 'Alacritty',
      width: 720,
      height: 1280,
    }),
  });

  const session = await launchRes.json();
  console.log(`[E2E-TEST] Sesión creada: ${session.id} (PID: ${session.pid})`);

  console.log('[E2E-TEST] 4. Conectando WebSocket y solicitando streaming...');
  const ws = new WebSocket('wss://127.0.0.1:4096/ws');
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve) => {
    ws.on('open', () => {
      console.log('[E2E-TEST] WebSocket conectado. Solicitando attach_stream...');
      ws.send(JSON.stringify({
        type: 'attach_stream',
        sessionId: session.id,
        width: 720,
        height: 1280,
        fps: 30,
      }));
      resolve(true);
    });
  });

  console.log('[E2E-TEST] 5. Esperando recepción de fotogramas JPEG y comprobando contenido visual...');
  let framesReceived = 0;
  let verifiedVisualContent = false;
  let meanPixelValue = 0;
  let variancePixelValue = 0;
  let stddevPixelValue = 0;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout esperando fotogramas (recibidos: ${framesReceived})`));
    }, 12000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data);
        if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
          framesReceived++;
          if (framesReceived <= 3 || framesReceived === 10) {
            console.log(`[E2E-TEST] Recibido fotograma JPEG #${framesReceived} (${buf.length} bytes)`);
          }

          // Programmatically decode frame and verify active pixels (mean + variance).
          // Un gris sólido del compositor (mean ~128, varianza ~0) pasaba el
          // check antiguo de mean>1.0: ahora se exige stddev>12 y se reporta GRAY_FRAME.
          if (framesReceived >= 2 && !verifiedVisualContent) {
            try {
              const probeProc = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-f', 'rawvideo',
                '-pix_fmt', 'gray',
                'pipe:1',
              ], { stdio: ['pipe', 'pipe', 'ignore'] });

              const chunks = [];
              probeProc.stdout.on('data', (c) => chunks.push(c));
              probeProc.on('close', (code) => {
                if (code === 0) {
                  const raw = Buffer.concat(chunks);
                  if (raw.length > 0) {
                    let sum = 0;
                    for (let i = 0; i < raw.length; i++) sum += raw[i];
                    const mean = sum / raw.length;
                    let varSum = 0;
                    const hist = new Array(256).fill(0);
                    for (let i = 0; i < raw.length; i++) {
                      const d = raw[i] - mean;
                      varSum += d * d;
                      hist[raw[i]]++;
                    }
                    const variance = varSum / raw.length;
                    const stddev = Math.sqrt(variance);
                    // Rango p95-p5 desde el histograma (veredicto GRIS vs CONTENIDO).
                    const total = raw.length;
                    const pct = (q) => {
                      let acc = 0;
                      for (let v = 0; v < 256; v++) {
                        acc += hist[v];
                        if (acc / total >= q) return v;
                      }
                      return 255;
                    };
                    const range95 = pct(0.95) - pct(0.05);
                    meanPixelValue = mean;
                    variancePixelValue = variance;
                    stddevPixelValue = stddev;
                    console.log(`[E2E-TEST] 🔍 Análisis del búfer gráfico: ${raw.length} píxeles decodificados, mean=${mean.toFixed(2)}/255 stddev=${stddev.toFixed(2)} p95-p5=${range95}`);
                    if (variance < 90 && mean > 40 && mean < 215) {
                      console.warn(`[E2E-TEST] GRAY_FRAME: gris sólido (mean=${mean.toFixed(1)}, vari=${variance.toFixed(1)}) — no cuenta como contenido`);
                      return;
                    }
                    if (mean > 1.0 && stddev > 12) {
                      verifiedVisualContent = true;
                    }
                  }
                }
              });

              probeProc.stdin.write(buf);
              probeProc.stdin.end();
            } catch (err) {
              console.warn('[E2E-TEST] Error analizando píxeles:', err);
            }
          }

          if (framesReceived >= 10 && verifiedVisualContent) {
            clearTimeout(timer);
            resolve(true);
          }
        }
      }
    });
  });

  if (!verifiedVisualContent) {
    if (variancePixelValue < 90 && meanPixelValue > 40 && meanPixelValue < 215) {
      throw new Error(`GRAY_FRAME: frame gris sólido sin contenido (mean=${meanPixelValue.toFixed(2)}, vari=${variancePixelValue.toFixed(2)}, stddev=${stddevPixelValue.toFixed(2)})`);
    }
    throw new Error(`El búfer capturado está negro o vacío (mean=${meanPixelValue.toFixed(2)}, stddev=${stddevPixelValue.toFixed(2)})`);
  }

  console.log(`[E2E-TEST] ✅ Fotogramas con datos visuales activos verificados (mean=${meanPixelValue.toFixed(2)} > 1.0, stddev=${stddevPixelValue.toFixed(2)} > 12)`);

  console.log('[E2E-TEST] 6. Verificando resiliencia ante reconexión y múltiples clientes concurrentes...');
  const wsReconnect = new WebSocket('wss://127.0.0.1:4096/ws');
  wsReconnect.binaryType = 'arraybuffer';
  await new Promise((resolve) => wsReconnect.on('open', resolve));

  wsReconnect.send(JSON.stringify({
    type: 'attach_stream',
    sessionId: session.id,
    width: 720,
    height: 1280,
    fps: 30,
  }));

  let reconnectFrames = 0;
  wsReconnect.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.from(data);
      if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
        reconnectFrames++;
      }
    }
  });

  // Close primary ws while secondary client is receiving stream
  ws.close();

  // Wait to confirm secondary ws receives subsequent frames continuously
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (reconnectFrames >= 5) resolve(true);
      else reject(new Error(`Fallo en reconexión: solo se recibieron ${reconnectFrames} fotogramas`));
    }, 4000);

    const checkInterval = setInterval(() => {
      if (reconnectFrames >= 5) {
        clearInterval(checkInterval);
        clearTimeout(timer);
        resolve(true);
      }
    }, 100);
  });

  console.log(`[E2E-TEST] ✅ Cliente reconectado recibió satisfactoriamente ${reconnectFrames} fotogramas activos.`);
  wsReconnect.close();

  console.log('[E2E-TEST] 7. Cerrando sesión...');
  await fetch('https://127.0.0.1:4096/api/sessions/terminate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id }),
  });

  console.log('[E2E-TEST] ✅ TEST DE STREAMING COMPLETO SUPERADO CON ÉXITO');
} finally {
  serverProc.kill('SIGTERM');
}
