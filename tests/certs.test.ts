import { describe, it, expect, afterAll } from 'vitest';
import { getOrCreateCertificates } from '../server/certs.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('TLS Certificates', () => {
  const testCertDir = path.resolve(import.meta.dirname, '.test-certs');

  afterAll(() => {
    if (fs.existsSync(testCertDir)) {
      fs.rmSync(testCertDir, { recursive: true, force: true });
    }
  });

  it('debe generar certificados TLS autofirmados válidos para https local', () => {
    const certs = getOrCreateCertificates(testCertDir);
    expect(certs).toHaveProperty('cert');
    expect(certs).toHaveProperty('key');
    expect(certs.cert).toContain('BEGIN CERTIFICATE');
    expect(certs.key).toContain('PRIVATE KEY');

    // Debe cargar los mismos en subsiguientes llamadas
    const secondCall = getOrCreateCertificates(testCertDir);
    expect(secondCall.cert).toBe(certs.cert);
    expect(secondCall.key).toBe(certs.key);
  });
});
