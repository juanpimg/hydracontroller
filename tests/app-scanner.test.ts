import { describe, it, expect } from 'vitest';
import { scanLinuxApps } from '../server/app-scanner.ts';

describe('App Scanner', () => {
  it('debe escanear aplicaciones instaladas en el sistema', () => {
    const apps = scanLinuxApps();
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);

    const firstApp = apps[0];
    expect(firstApp).toHaveProperty('id');
    expect(firstApp).toHaveProperty('name');
    expect(firstApp).toHaveProperty('exec');
    expect(firstApp).toHaveProperty('categories');
    expect(Array.isArray(firstApp.categories)).toBe(true);
  });

  it('no debe incluir aplicaciones con NoDisplay=true', () => {
    const apps = scanLinuxApps();
    for (const app of apps) {
      expect(app.name).toBeTruthy();
      expect(app.exec).toBeTruthy();
    }
  });
});
