import React from 'react';
import { X, LayoutGrid, AppWindow } from 'lucide-react';

export interface RunningSession {
  id: string;
  appId: string;
  appName: string;
  width: number;
  height: number;
}

interface RunningTasksProps {
  sessions: RunningSession[];
  activeSessionId: string | null;
  onSelectSession: (session: RunningSession) => void;
  onCloseSession: (sessionId: string) => void;
  onBackToLauncher: () => void;
}

export const RunningTasks: React.FC<RunningTasksProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onBackToLauncher,
}) => {
  return (
    <footer className="h-16 bg-slate-900/95 border-t border-slate-800 px-3 flex items-center gap-2 overflow-x-auto shrink-0 select-none z-30">
      {/* Home / Launcher Button */}
      <button
        onClick={onBackToLauncher}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all ${
          activeSessionId === null
            ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
            : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300'
        }`}
      >
        <LayoutGrid className="w-4 h-4" />
        <span>Lanzador</span>
      </button>

      {/* Divider */}
      <div className="w-[1px] h-6 bg-slate-800 shrink-0 mx-1" />

      {/* Running App Tabs */}
      {sessions.length === 0 ? (
        <span className="text-[11px] text-slate-500 italic pl-1">
          Ninguna app en ejecución
        </span>
      ) : (
        sessions.map((sess) => {
          const isActive = activeSessionId === sess.id;
          return (
            <div
              key={sess.id}
              className={`flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl border text-xs font-medium shrink-0 transition-all cursor-pointer ${
                isActive
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => onSelectSession(sess)}
            >
              <AppWindow className="w-3.5 h-3.5 text-cyan-400" />
              <span className="truncate max-w-[110px]">{sess.appName}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSession(sess.id);
                }}
                className="p-1 rounded-lg hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 transition-colors ml-1"
                title="Cerrar ventana"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })
      )}
    </footer>
  );
};
