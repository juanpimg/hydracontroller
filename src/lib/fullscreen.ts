// Helpers puros para el botón de pantalla completa.
// En Safari de iPhone no existe la Fullscreen API y en PWA instalada ya vas
// a pantalla completa: en ambos casos el botón no pinta nada y se oculta.

export function canUseFullscreen(
  fullscreenEnabled: boolean,
  webkitFullscreenEnabled: boolean,
  standalone: boolean
): boolean {
  if (standalone) return false;
  return fullscreenEnabled || webkitFullscreenEnabled;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as any)?.standalone === true;
}
