// Mapeo tecla web (e.key) -> keycode evdev Linux.
// Posicional QWERTY (como el hardware): Q=16, W=17 ... A=30 ... Z=44, M=50.
// Dígitos de la fila superior: 1=2 ... 0=11. 0 = sin mapeo (no enviar).

const SPECIAL: Record<string, number> = {
  Backspace: 14,
  Enter: 28,
  ' ': 57,
  Escape: 1,
  Tab: 15,
};

const LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM';
const LETTER_CODES = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 36, 37, 38, 44, 45, 46, 47, 48, 49, 50];

const DIGITS: Record<string, number> = {
  '1': 2, '2': 3, '3': 4, '4': 5, '5': 6,
  '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
};

const PUNCT: Record<string, number> = {
  '-': 12,
  '=': 13,
  ',': 51,
  '.': 52,
  '/': 53,
  ';': 39,
  "'": 40,
};

export function webKeyToLinuxCode(key: string): number {
  if (key in SPECIAL) return SPECIAL[key];
  const up = key.toUpperCase();
  const li = LETTERS.indexOf(up);
  if (li !== -1 && key.length === 1) return LETTER_CODES[li];
  if (key in DIGITS) return DIGITS[key];
  if (key in PUNCT) return PUNCT[key];
  return 0;
}
