import React from 'react';
import { Wifi, Volume2, RefreshCw, Smartphone, Monitor, Github } from 'lucide-react';

interface StatusBarProps {
  isConnected: boolean;
  latency: number | null;
  audioToClient: boolean;
  onToggleAudio: () => void;
  onRefreshApps: () => void;
  activeAppTitle?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  latency,
  audioToClient,
  onToggleAudio,
  onRefreshApps,
  activeAppTitle,
}) => {
  return (
    <header className="h-14 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-4 flex items-center justify-between z-30 shrink-0 select-none">
      {/* Left: Branding & App Title */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
          <Smartphone className="w-4 h-4" />
          <span
            className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 ${
              isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold tracking-wider text-slate-200">
            HYDRA <span className="text-cyan-400">DECK</span>
          </span>
          {activeAppTitle && (
            <span className="text-[10px] text-cyan-300 font-medium truncate max-w-[150px]">
              {activeAppTitle}
            </span>
          )}
        </div>
      </div>

      {/* Right: Latency, Audio, Refresh */}
      <div className="flex items-center gap-2">
        {/* Latency Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-[11px] text-slate-300 font-mono">
          <Wifi className={`w-3.5 h-3.5 ${latency && latency < 30 ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span>{latency !== null ? `${latency} ms` : '--'}</span>
        </div>

        {/* Audio Toggle */}
        <button
          onClick={onToggleAudio}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
            audioToClient
              ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
              : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
          }`}
          title={audioToClient ? 'Audio reproduciéndose en el móvil' : 'Audio en los altavoces del PC'}
        >
          {audioToClient ? (
            <>
              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Móvil</span>
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5 text-slate-400" />
              <span>PC</span>
            </>
          )}
        </button>

        {/* Refresh button */}
        <button
          onClick={onRefreshApps}
          className="p-1.5 rounded-full bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
          title="Actualizar aplicaciones del PC"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* GitHub */}
        <a
          href="https://github.com/juanpimg/hydracontroller"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-full bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
          title="Ver código en GitHub — ¡contribuye!"
          aria-label="Ver HydraController en GitHub (pestaña nueva)"
        >
          <Github className="w-3.5 h-3.5" />
        </a>
      </div>
    </header>
  );
};
