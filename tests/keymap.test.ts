import { describe, it, expect } from 'vitest';
import { keycodeToKeysym } from '../server/virtual-display.ts';
import { webKeyToLinuxCode } from '../src/lib/keymap.ts';

describe('keycodeToKeysym (evdev -> X keysym)', () => {
  it('mapea letras A-Z (antes se descartaban en silencio)', () => {
    expect(keycodeToKeysym(30)).toBe('a');
    expect(keycodeToKeysym(48)).toBe('b');
    expect(keycodeToKeysym(16)).toBe('q');
    expect(keycodeToKeysym(17)).toBe('w');
    expect(keycodeToKeysym(50)).toBe('m');
    expect(keycodeToKeysym(44)).toBe('z');
  });

  it('mapea dígitos 0-9', () => {
    expect(keycodeToKeysym(2)).toBe('1');
    expect(keycodeToKeysym(6)).toBe('5');
    expect(keycodeToKeysym(11)).toBe('0');
  });

  it('mapea puntuación común', () => {
    expect(keycodeToKeysym(12)).toBe('minus');
    expect(keycodeToKeysym(13)).toBe('equal');
    expect(keycodeToKeysym(51)).toBe('comma');
    expect(keycodeToKeysym(52)).toBe('period');
  });

  it('conserva las especiales y devuelve undefined si no existe', () => {
    expect(keycodeToKeysym(14)).toBe('BackSpace');
    expect(keycodeToKeysym(28)).toBe('Return');
    expect(keycodeToKeysym(57)).toBe('space');
    expect(keycodeToKeysym(999)).toBeUndefined();
  });
});

describe('webKeyToLinuxCode (tecla web -> evdev)', () => {
  it('mapea especiales', () => {
    expect(webKeyToLinuxCode('Backspace')).toBe(14);
    expect(webKeyToLinuxCode('Enter')).toBe(28);
    expect(webKeyToLinuxCode(' ')).toBe(57);
    expect(webKeyToLinuxCode('Escape')).toBe(1);
    expect(webKeyToLinuxCode('Tab')).toBe(15);
  });

  it('mapea letras insensible a mayúsculas', () => {
    expect(webKeyToLinuxCode('a')).toBe(30);
    expect(webKeyToLinuxCode('A')).toBe(30);
    expect(webKeyToLinuxCode('q')).toBe(16);
    expect(webKeyToLinuxCode('m')).toBe(50);
  });

  it('mapea dígitos y puntuación (antes se perdían: code 0)', () => {
    expect(webKeyToLinuxCode('1')).toBe(2);
    expect(webKeyToLinuxCode('5')).toBe(6);
    expect(webKeyToLinuxCode('0')).toBe(11);
    expect(webKeyToLinuxCode('-')).toBe(12);
    expect(webKeyToLinuxCode('=')).toBe(13);
    expect(webKeyToLinuxCode(',')).toBe(51);
    expect(webKeyToLinuxCode('.')).toBe(52);
  });

  it('devuelve 0 si no hay mapeo', () => {
    expect(webKeyToLinuxCode('Unidentified')).toBe(0);
    expect(webKeyToLinuxCode('Shift')).toBe(0);
    expect(webKeyToLinuxCode('ñ')).toBe(0);
  });
});
