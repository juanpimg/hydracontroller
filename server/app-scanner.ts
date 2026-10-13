import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface LinuxApp {
  id: string;
  name: string;
  exec: string;
  icon: string;
  iconPath?: string;
  comment?: string;
  categories: string[];
  terminal: boolean;
}

const DESKTOP_DIRS = [
  path.join(os.homedir(), '.local/share/applications'),
  '/usr/local/share/applications',
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
];

const ICON_DIRS = [
  path.join(os.homedir(), '.local/share/icons'),
  '/usr/share/pixmaps',
  '/usr/share/icons/hicolor',
  '/usr/share/icons',
];

function resolveIconPath(iconName: string): string | undefined {
  if (!iconName) return undefined;
  if (path.isAbsolute(iconName) && fs.existsSync(iconName)) {
    return iconName;
  }

  // Extensions to check
  const exts = ['.svg', '.png', '.xpm', ''];

  for (const baseDir of ICON_DIRS) {
    if (!fs.existsSync(baseDir)) continue;

    // Check direct file
    for (const ext of exts) {
      const candidate = path.join(baseDir, `${iconName}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }

    // Check hicolor subdirs (scalable, 128x128, 48x48, etc.)
    const subdirs = ['scalable/apps', '128x128/apps', '64x64/apps', '48x48/apps', 'apps'];
    for (const sub of subdirs) {
      for (const ext of exts) {
        const candidate = path.join(baseDir, sub, `${iconName}${ext}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return undefined;
}

export function scanLinuxApps(): LinuxApp[] {
  const appsMap = new Map<string, LinuxApp>();

  for (const dir of DESKTOP_DIRS) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue;
        const filePath = path.join(dir, file);

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          let inDesktopEntry = false;
          let name = '';
          let exec = '';
          let icon = '';
          let comment = '';
          let noDisplay = false;
          let terminal = false;
          let categories: string[] = [];

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
              inDesktopEntry = line === '[Desktop Entry]';
              continue;
            }

            if (!inDesktopEntry || line.startsWith('#') || !line.includes('=')) continue;

            const eqIdx = line.indexOf('=');
            const key = line.slice(0, eqIdx).trim();
            const val = line.slice(eqIdx + 1).trim();

            if (key === 'Name' && !name) name = val;
            else if (key === 'Exec') exec = val;
            else if (key === 'Icon') icon = val;
            else if (key === 'Comment' && !comment) comment = val;
            else if (key === 'NoDisplay' && val.toLowerCase() === 'true') noDisplay = true;
            else if (key === 'Terminal' && val.toLowerCase() === 'true') terminal = true;
            else if (key === 'Categories') {
              categories = val.split(';').map(c => c.trim()).filter(Boolean);
            }
          }

          if (noDisplay || !name || !exec) continue;

          // Clean Exec arguments like %u, %F, %f, etc.
          const cleanExec = exec.replace(/%[uUfFdiInkmv]/g, '').trim();

          const id = path.basename(file, '.desktop');
          if (!appsMap.has(id)) {
            const resolvedIcon = resolveIconPath(icon);
            appsMap.set(id, {
              id,
              name,
              exec: cleanExec,
              icon: icon || 'application-x-executable',
              iconPath: resolvedIcon,
              comment,
              categories: categories.length > 0 ? categories : ['Herramientas'],
              terminal,
            });
          }
        } catch {
          // Ignore individual unreadable file
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  return Array.from(appsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}
