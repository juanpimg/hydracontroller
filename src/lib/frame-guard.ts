// Helpers puros del frame guard del frontend (sin DOM: testeables en vitest).
// Mismo umbral que el backend (server/streamer.ts): los fragmentos
// JPEG <800B son cabeceras parciales o ruido, nunca un frame visible.

/** Tamaño mínimo en bytes para considerar un chunk un frame válido. */
export const MIN_FRAME_BYTES = 800;

/** true si el chunk es demasiado pequeño para ser un frame real. */
export function shouldDropFrame(sizeBytes: number): boolean {
  return sizeBytes < MIN_FRAME_BYTES;
}

/**
 * Sonda gris: el fondo del compositor sin app real compone un gris
 * plano (media ~128, varianza ~0). Un frame con contenido tiene
 * textura (varianza alta) o es negro de verdad (media baja).
 * true si 40 < media < 215 y varianza < 90.
 */
export function isGrayFrame(mean: number, variance: number): boolean {
  return variance < 90 && mean > 40 && mean < 215;
}
