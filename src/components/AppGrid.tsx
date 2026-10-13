import React, { useState, useMemo } from 'react';
import { Search, Star, Layers } from 'lucide-react';

export interface LinuxApp {
  id: string;
  name: string;
  exec: string;
  icon: string;
  comment?: string;
  categories: string[];
  terminal: boolean;
}

interface AppGridProps {
  apps: LinuxApp[];
  onLaunchApp: (app: LinuxApp) => void;
  favorites: string[];
  onToggleFavorite: (appId: string) => void;
  isLoading: boolean;
}

export const AppGrid: React.FC<AppGridProps> = ({
  apps,
  onLaunchApp,
  favorites,
  onToggleFavorite,
  isLoading,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todas');

  // Compute all unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    apps.forEach((a) => {
      a.categories.forEach((cat) => {
        // Map common categories to friendly names
        if (cat.includes('Audio') || cat.includes('Video') || cat.includes('Media')) set.add('Multimedia');
        else if (cat.includes('Network') || cat.includes('WebBrowser')) set.add('Internet');
        else if (cat.includes('System')) set.add('Sistema');
        else if (cat.includes('Development')) set.add('Desarrollo');
        else if (cat.includes('Utility')) set.add('Utilidades');
      });
    });
    return ['Todas', 'Favoritas', ...Array.from(set).sort()];
  }, [apps]);

  // Filtered Apps
  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      const matchesSearch =
        app.name.toLowerCase().includes(search.toLowerCase()) ||
        (app.comment && app.comment.toLowerCase().includes(search.toLowerCase()));

      if (!matchesSearch) return false;

      if (activeCategory === 'Todas') return true;
      if (activeCategory === 'Favoritas') return favorites.includes(app.id);

      const hasCategory = app.categories.some((cat) => {
        if (activeCategory === 'Multimedia') return cat.includes('Audio') || cat.includes('Video') || cat.includes('Media');
        if (activeCategory === 'Internet') return cat.includes('Network') || cat.includes('WebBrowser');
        if (activeCategory === 'Sistema') return cat.includes('System');
        if (activeCategory === 'Desarrollo') return cat.includes('Development');
        if (activeCategory === 'Utilidades') return cat.includes('Utility');
        return false;
      });

      return hasCategory;
    });
  }, [apps, search, activeCategory, favorites]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 p-4 gap-4">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar aplicación en tu PC..."
          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
        />
      </div>

      {/* Categories Scroll */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0 no-scrollbar">
        {categories.map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/20'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Apps Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
            Cargando aplicaciones instaladas...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
            <Layers className="w-8 h-8 stroke-[1.5]" />
            <p>No se encontraron aplicaciones</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {filteredApps.map((app) => {
              const isFav = favorites.includes(app.id);
              return (
                <div
                  key={app.id}
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(20);
                    onLaunchApp(app);
                  }}
                  className="group relative flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-900/60 border border-slate-850 hover:border-cyan-500/40 active:scale-95 hover:bg-slate-900 transition-all cursor-pointer select-none text-center"
                >
                  {/* Star Favorite Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(app.id);
                    }}
                    className="absolute top-2 right-2 p-1 text-slate-600 hover:text-amber-400 transition-colors"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                      }`}
                    />
                  </button>

                  {/* App Icon */}
                  <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 p-2 flex items-center justify-center mb-2 shadow-inner group-hover:border-cyan-500/30 transition-all">
                    <img
                      src={`/api/apps/icon/${encodeURIComponent(app.id)}`}
                      alt={app.name}
                      onError={(e) => {
                        // Fallback SVG icon on image error
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* App Name */}
                  <span className="text-xs font-medium text-slate-200 line-clamp-1 w-full">
                    {app.name}
                  </span>
                  {app.comment && (
                    <span className="text-[10px] text-slate-500 line-clamp-1 w-full mt-0.5">
                      {app.comment}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
