import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from './components/StatusBar.tsx';
import { AppGrid, LinuxApp } from './components/AppGrid.tsx';
import { RunningTasks, RunningSession } from './components/RunningTasks.tsx';
import { StreamView } from './components/StreamView.tsx';
import { useHydraSocket } from './hooks/useHydraSocket.ts';

export const App: React.FC = () => {
  const [apps, setApps] = useState<LinuxApp[]>([]);
  const [sessions, setSessions] = useState<RunningSession[]>([]);
  const [activeSession, setActiveSession] = useState<RunningSession | null>(null);
  const [isLoadingApps, setIsLoadingApps] = useState(true);
  const [audioToClient, setAudioToClient] = useState(true);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('hydra_fav_apps');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const {
    isConnected,
    latency,
    sendTouch,
    sendSync,
    sendKey,
    attachStream,
    setOnVideoChunk,
  } = useHydraSocket();

  // Load apps from backend
  const loadApps = useCallback(async () => {
    setIsLoadingApps(true);
    try {
      const res = await fetch('/api/apps');
      if (res.ok) {
        const data = await res.json();
        setApps(data);
      }
    } catch (err) {
      console.error('Error fetching apps:', err);
    } finally {
      setIsLoadingApps(false);
    }
  }, []);

  // Load active sessions
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  }, []);

  useEffect(() => {
    loadApps();
    loadSessions();
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [loadApps, loadSessions]);

  // Toggle favorite
  const handleToggleFavorite = (appId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId];
      localStorage.setItem('hydra_fav_apps', JSON.stringify(next));
      return next;
    });
  };

  // Launch app with phone's exact screen dimensions
  const handleLaunchApp = async (app: LinuxApp) => {
    // Detect mobile device resolution & aspect ratio
    const width = window.innerWidth || 720;
    const height = window.innerHeight || 1280;

    try {
      const res = await fetch('/api/sessions/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          width,
          height,
        }),
      });

      if (res.ok) {
        const session: RunningSession = await res.json();
        setSessions((prev) => [...prev.filter((s) => s.id !== session.id), session]);
        setActiveSession(session);
      }
    } catch (err) {
      console.error('Error launching app:', err);
    }
  };

  // Close session
  const handleCloseSession = async (sessionId: string) => {
    try {
      await fetch('/api/sessions/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
      }
    } catch (err) {
      console.error('Error closing session:', err);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-slate-950 overflow-hidden font-sans select-none">
      {/* Top Status Bar */}
      <StatusBar
        isConnected={isConnected}
        latency={latency}
        audioToClient={audioToClient}
        onToggleAudio={() => setAudioToClient((prev) => !prev)}
        onRefreshApps={loadApps}
        activeAppTitle={activeSession?.appName}
      />

      {/* Main View: Launcher vs Streaming Session */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeSession ? (
          <StreamView
            session={activeSession}
            onClose={() => handleCloseSession(activeSession.id)}
            onBack={() => setActiveSession(null)}
            sendTouch={sendTouch}
            sendSync={sendSync}
            sendKey={sendKey}
            attachStream={attachStream}
            setOnVideoChunk={setOnVideoChunk}
          />
        ) : (
          <AppGrid
            apps={apps}
            onLaunchApp={handleLaunchApp}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            isLoading={isLoadingApps}
          />
        )}
      </main>

      {/* Bottom Running Tasks Switcher */}
      <RunningTasks
        sessions={sessions}
        activeSessionId={activeSession?.id || null}
        onSelectSession={(sess) => setActiveSession(sess)}
        onCloseSession={handleCloseSession}
        onBackToLauncher={() => setActiveSession(null)}
      />
    </div>
  );
};

export default App;
