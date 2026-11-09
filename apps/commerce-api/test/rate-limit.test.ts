/** RT-R1 H2: el límite de intentos de login usa la IP real del socket, no cabeceras que controla el cliente. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, shutdown } from './harness.ts';

process.env.AUTH_RATE_LIMIT = 'on';
const h = makeApp();
beforeAll(async () => { await h.app.ready(); });
afterAll(async () => { await shutdown(h.app); });

const attempt = (ip: string, xff?: string) => h.app.inject({
  method: 'POST', url: '/api/auth/sign-in/email', remoteAddress: ip,
  headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
  payload: { email: `nadie-${ip}@test.local`, password: 'contraseña-incorrecta' },
});

describe('límite de intentos de inicio de sesión', () => {
  it('rotar X-Forwarded-For no evita el bloqueo', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await attempt('10.1.0.1', `198.51.100.${i}`)).statusCode);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
  });
  it('el bloqueo de una IP no afecta a otra (no hay un cubo global)', async () => {
    expect((await attempt('10.1.0.2')).statusCode).not.toBe(429);
  });
});
