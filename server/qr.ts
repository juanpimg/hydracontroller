import qrcode from 'qrcode-terminal';
import os from 'node:os';

export function getLocalIPAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
}

export function displayConnectionBanner(port: number) {
  const ips = getLocalIPAddresses();
  const primaryIp = ips[0] || '127.0.0.1';
  const connectionUrl = `https://${primaryIp}:${port}`;

  console.log('\n=============================================================');
  console.log('       📱 HYDRA CONTROLLER — LINUX MOBILE DECK              ');
  console.log('=============================================================\n');

  console.log('Escanea este código QR con la cámara de tu móvil para conectar:');
  qrcode.generate(connectionUrl, { small: true });

  console.log(`\n🔗 URL Directa:  \x1b[36m\x1b[1m${connectionUrl}\x1b[0m`);
  console.log(`🌐 mDNS Local:    \x1b[32mhttps://hydra.local:${port}\x1b[0m`);
  console.log('\nPresiona Ctrl+C en cualquier momento para detener el servidor.\n');
  console.log('-------------------------------------------------------------\n');
}
