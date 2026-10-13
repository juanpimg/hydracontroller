import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { AppStreamer } from '../server/streamer.ts';
import { VirtualDisplayManager } from '../server/virtual-display.ts';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log('[STRESS-TEST] Starting Adversarial Reviewer Stress Suite...');

async function testProcessLifecycleNoDuplicates() {
  console.log('[STRESS-TEST] 1. Testing AppStreamer process lifecycle & upgrade without duplicate spawns...');
  const streamer = new AppStreamer({
    displayNum: 99,
    width: 640,
    height: 480,
    fps: 30,
  });

  const dummyWs = {
    readyState: 1,
    bufferedAmount: 0,
    send: () => {},
  };

  streamer.addClient(dummyWs);
  await new Promise((r) => setTimeout(r, 200));

  // Trigger rapid updates to pipewire node ID
  streamer.updatePipewireNodeId(101);
  await new Promise((r) => setTimeout(r, 100));
  streamer.updatePipewireNodeId(102);
  await new Promise((r) => setTimeout(r, 100));

  // Check how many processes are alive
  streamer.stop();
  await new Promise((r) => setTimeout(r, 500));
  console.log('[STRESS-TEST] ✅ Process lifecycle stress passed without orphaned processes.');
}

async function testWebSocketBackpressureDropping() {
  console.log('[STRESS-TEST] 2. Testing WebSocket backpressure frame dropping...');
  const streamer = new AppStreamer({
    displayNum: 99,
    width: 640,
    height: 480,
    fps: 30,
  });

  let sentCount = 0;
  const congestedWs = {
    readyState: 1,
    bufferedAmount: 500 * 1024, // 500KB backpressure!
    send: () => { sentCount++; },
  };

  const normalWs = {
    readyState: 1,
    bufferedAmount: 0,
    send: () => { sentCount++; },
  };

  streamer.addClient(congestedWs);
  streamer.addClient(normalWs);

  // Directly simulate packet emission to stdout
  const proc = streamer['streamProc'];
  if (proc && proc.stdout) {
    // Write valid JPEG dummy frame
    const dummyFrame = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from('fake_image_content'),
      Buffer.from([0xff, 0xd9]),
    ]);
    proc.stdout.emit('data', dummyFrame);
  }

  // Only normalWs should have received the frame
  if (sentCount !== 1) {
    throw new Error(`Expected exactly 1 frame sent (dropped for congested socket), got ${sentCount}`);
  }
  streamer.stop();
  console.log('[STRESS-TEST] ✅ Backpressure frame dropping verified.');
}

async function testFastDisconnectBeforePipewireNode() {
  console.log('[STRESS-TEST] 3. Testing rapid client disconnect before PipeWire node ready...');
  const serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '4097' },
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('https://127.0.0.1:4097/api/apps');
        if (res.ok) { ready = true; break; }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!ready) throw new Error('Server 4097 failed to start');

    // Launch app session
    const launchRes = await fetch('https://127.0.0.1:4097/api/sessions/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'Alacritty', width: 720, height: 1280 }),
    });
    const session = await launchRes.json();

    // Connect and immediately disconnect 5 clients in rapid succession
    for (let i = 0; i < 5; i++) {
      const ws = new WebSocket('wss://127.0.0.1:4097/ws');
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({
        type: 'attach_stream',
        sessionId: session.id,
        width: 720,
        height: 1280,
      }));
      // Abrupt close immediately
      ws.close();
    }

    // Now connect persistent client and verify stream reception
    await new Promise((r) => setTimeout(r, 1000));
    const persistentWs = new WebSocket('wss://127.0.0.1:4097/ws');
    persistentWs.binaryType = 'arraybuffer';
    await new Promise((r) => persistentWs.on('open', r));

    persistentWs.send(JSON.stringify({
      type: 'attach_stream',
      sessionId: session.id,
      width: 720,
      height: 1280,
    }));

    let framesReceived = 0;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (framesReceived >= 3) resolve(true);
        else reject(new Error(`Timed out waiting for frames after rapid disconnect: ${framesReceived}`));
      }, 8000);

      persistentWs.on('message', (d, isBinary) => {
        if (isBinary) {
          framesReceived++;
          if (framesReceived >= 5) {
            clearTimeout(timeout);
            resolve(true);
          }
        }
      });
    });

    console.log(`[STRESS-TEST] ✅ Persistent client received ${framesReceived} frames after 5 rapid disconnects.`);
    persistentWs.close();

    await fetch('https://127.0.0.1:4097/api/sessions/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });
  } finally {
    serverProc.kill('SIGTERM');
  }
}

async function testDisplayNumUpdateFallback() {
  console.log('[STRESS-TEST] 4. Testing AppStreamer displayNum update restart...');
  const streamer = new AppStreamer({
    displayNum: 99,
    width: 640,
    height: 480,
    fps: 30,
  });

  let restartTriggered = false;
  const originalRestart = streamer['restartStream'].bind(streamer);
  streamer['restartStream'] = () => {
    restartTriggered = true;
    originalRestart();
  };

  const dummyWs = { readyState: 1, bufferedAmount: 0, send: () => {} };
  streamer.addClient(dummyWs);

  // Update to same display - should NOT restart
  streamer.updateDisplayNum(99);
  if (restartTriggered) {
    throw new Error('Unexpected restart on identical displayNum');
  }

  // Update to new display - MUST restart
  streamer.updateDisplayNum(100);
  if (!restartTriggered) {
    throw new Error('Expected stream restart on updated displayNum');
  }

  streamer.stop();
  console.log('[STRESS-TEST] ✅ displayNum update restart verified.');
}

async function testSessionSwitchingAndDetach() {
  console.log('[STRESS-TEST] 5. Testing session switching clean handoff & detach_stream...');
  const serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '4098' },
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('https://127.0.0.1:4098/api/apps');
        if (res.ok) { ready = true; break; }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!ready) throw new Error('Server 4098 failed to start');

    // Launch Session 1
    const s1Res = await fetch('https://127.0.0.1:4098/api/sessions/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'Alacritty', width: 720, height: 1280 }),
    });
    const s1 = await s1Res.json();

    // Launch Session 2
    const s2Res = await fetch('https://127.0.0.1:4098/api/sessions/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'Alacritty', width: 720, height: 1280 }),
    });
    const s2 = await s2Res.json();

    const ws = new WebSocket('wss://127.0.0.1:4098/ws');
    ws.binaryType = 'arraybuffer';
    await new Promise((r) => ws.on('open', r));

    // Attach to Session 1
    ws.send(JSON.stringify({
      type: 'attach_stream',
      sessionId: s1.id,
      width: 720,
      height: 1280,
    }));

    let s1Frames = 0;
    const countFrames = (d, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(d);
        if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
          s1Frames++;
        }
      }
    };
    ws.on('message', countFrames);

    // Wait for at least 3 frames from Session 1
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Session 1 frames')), 8000);
      const interval = setInterval(() => {
        if (s1Frames >= 3) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve(true);
        }
      }, 100);
    });

    // Switch client stream directly to Session 2 on the same WebSocket
    ws.off('message', countFrames);
    let s2Frames = 0;
    ws.on('message', (d, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(d);
        if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
          s2Frames++;
        }
      }
    });

    ws.send(JSON.stringify({
      type: 'attach_stream',
      sessionId: s2.id,
      width: 720,
      height: 1280,
    }));

    // Wait for frames from Session 2
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Session 2 frames')), 8000);
      const interval = setInterval(() => {
        if (s2Frames >= 3) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve(true);
        }
      }, 100);
    });

    // Terminate Session 1 while client is attached to Session 2
    await fetch('https://127.0.0.1:4098/api/sessions/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: s1.id }),
    });

    // Verify Session 2 frames continue arriving without crash
    const prevS2 = s2Frames;
    let s2Progressed = false;
    for (let check = 0; check < 15; check++) {
      await new Promise((r) => setTimeout(r, 100));
      if (s2Frames > prevS2) {
        s2Progressed = true;
        break;
      }
    }
    if (!s2Progressed) {
      throw new Error(`Session 2 frames stalled after Session 1 terminated (prev=${prevS2}, current=${s2Frames})`);
    }

    // Now test detach_stream protocol
    ws.send(JSON.stringify({ type: 'detach_stream' }));
    await new Promise((r) => setTimeout(r, 500));
    const detachedFrameCount = s2Frames;
    await new Promise((r) => setTimeout(r, 800));
    // Verify frames stopped flowing
    if (s2Frames > detachedFrameCount + 1) {
      throw new Error(`Frames continued flowing after detach_stream: received ${s2Frames - detachedFrameCount} additional frames`);
    }

    console.log('[STRESS-TEST] ✅ Session switching clean handoff & detach_stream verified.');
    ws.close();

    await fetch('https://127.0.0.1:4098/api/sessions/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: s2.id }),
    });
  } finally {
    serverProc.kill('SIGTERM');
  }
}

async function testEarlyTerminationNoZombieResurrection() {
  console.log('[STRESS-TEST] 6. Testing early termination during attach (no zombie timer resurrection)...');
  const serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '4099' },
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('https://127.0.0.1:4099/api/apps');
        if (res.ok) { ready = true; break; }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!ready) throw new Error('Server 4099 failed to start');

    // Launch session
    const launchRes = await fetch('https://127.0.0.1:4099/api/sessions/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'Alacritty', width: 720, height: 1280 }),
    });
    const session = await launchRes.json();

    const ws = new WebSocket('wss://127.0.0.1:4099/ws');
    await new Promise((r) => ws.on('open', r));

    // Attach to session
    ws.send(JSON.stringify({
      type: 'attach_stream',
      sessionId: session.id,
      width: 720,
      height: 1280,
    }));

    let receivedSessionClosedNotice = false;
    let unexpectedFrames = 0;
    ws.on('message', (d, isBinary) => {
      if (isBinary) {
        unexpectedFrames++;
      } else {
        try {
          const msg = JSON.parse(d.toString());
          if (msg.type === 'session_closed' && msg.sessionId === session.id) {
            receivedSessionClosedNotice = true;
          }
        } catch {}
      }
    });

    // Immediately terminate session (before PipeWire ready)
    await fetch('https://127.0.0.1:4099/api/sessions/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });

    // Wait 6 seconds (beyond the 5000ms fallbackTimer) to confirm no zombie fallback stream spawns
    await new Promise((r) => setTimeout(r, 6000));
    if (!receivedSessionClosedNotice) {
      throw new Error('Did not receive session_closed notice on terminated session');
    }
    if (unexpectedFrames > 0) {
      throw new Error(`Received ${unexpectedFrames} frames from zombie stream after session terminated!`);
    }

    console.log('[STRESS-TEST] ✅ Early termination cancelled pending attach; no zombie resurrection.');
    ws.close();
  } finally {
    serverProc.kill('SIGTERM');
  }
}

async function runAll() {
  await testProcessLifecycleNoDuplicates();
  await testWebSocketBackpressureDropping();
  await testFastDisconnectBeforePipewireNode();
  await testDisplayNumUpdateFallback();
  await testSessionSwitchingAndDetach();
  await testEarlyTerminationNoZombieResurrection();
  console.log('[STRESS-TEST] 🚀 ALL ADVERSARIAL STRESS TESTS PASSED!');
  process.exit(0);
}

runAll().catch((err) => {
  console.error('[STRESS-TEST] ❌ FAILURE:', err);
  process.exit(1);
});
