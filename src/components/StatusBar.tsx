import React from 'react';
import { Wifi, RefreshCw, Smartphone, Github, ArrowLeft, Keyboard, Maximize, X } from 'lucide-react';

export interface StreamControls {
  openKeyboard: () => void;
  toggleFullscreen: () => void;
}

interface StatusBarProps {
  isConnected: boolean;
  latency: number | null;
  onRefreshApps: () => void;
  activeAppTitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  streamControls?: StreamControls | null;
}

const iconBtn =
  'p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors';

export const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  latency,
  onRefreshApps,
  activeAppTitle,
  onBack,
  onClose,
  streamControls,
}) => {
  return (
    <header className="h-10 bg-slate-950 border-b border-slate-800 px-2 flex items-center justify-between z-30 shrink-0 select-none">
      {/* Left: back (in session) + brand/title */}
      <div className="flex items-center gap-1.5 min-w-0">
        {onBack && (
          <button onClick={onBack} className={iconBtn} title="Volver al lanzador">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        {!activeAppTitle && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
            HydraController
          </span>
        )}
        {activeAppTitle && (
          <span className="text-xs text-slate-200 font-medium truncate max-w-[130px]">
            {activeAppTitle}
          </span>
        )}
      </div>

      {/* Right: status + session controls */}
      <div className="flex items-center gap-1">
        <span
          className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}
          title={isConnected ? 'Conectado' : 'Desconectado'}
        />
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
          {latency !== null ? `${latency}ms` : '--'}
        </span>
        <Wifi className={`w-3.5 h-3.5 ${latency && latency < 30 ? 'text-emerald-400' : 'text-slate-600'}`} />
        {streamControls && (
          <>
            <button
              onClick={streamControls.openKeyboard}
              className={iconBtn}
              title="Abrir teclado nativo"
            >
              <Keyboard className="w-4 h-4" />
            </button>
            <button
              onClick={streamControls.toggleFullscreen}
              className={iconBtn}
              title="Pantalla completa"
            >
              <Maximize className="w-4 h-4" />
            </button>
            {onClose && (
              <button onClick={onClose} className={iconBtn} title="Cerrar sesión">
                <X className="w-4 h-4" />
              </button>
            )}
          </>
        )}
        {!activeAppTitle && (
          <>
            <button onClick={onRefreshApps} className={iconBtn} title="Actualizar aplicaciones del PC">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <a
              href="https://github.com/juanpimg/hydracontroller"
              target="_blank"
              rel="noopener noreferrer"
              className={iconBtn}
              title="Ver código en GitHub — ¡contribuye!"
              aria-label="Ver HydraController en GitHub (pestaña nueva)"
            >
              <Github className="w-3.5 h-3.5" />
            </a>
          </>
        )}
      </div>
    </header>
  );
};
