// Servidor del panel: Next.js detrás de un servidor HTTP propio que fija la IP real del cliente.
//
// Cadena de confianza (RT-PR1 #3):
//   navegador → [proxies de PANEL_TRUST_PROXY, p. ej. el balanceador] → este servidor → API (TRUST_PROXY = su IP)
// Este servidor descarta X-Forwarded-For/X-Real-IP/Forwarded del cliente y los sustituye por UNA sola IP:
//   - la del socket, si quien conecta no es un proxy de confianza;
//   - si lo es, la primera dirección no confiable leyendo X-Forwarded-For de derecha a izquierda.
// Así la API (que solo confía en este servidor) ve la IP real de cada usuario, y un cliente no puede
// falsificarla. Los rewrites de Next.js reenvían X-Forwarded-For tal cual, sin añadir la IP real.
import { createServer } from 'node:http';
import { BlockList, isIP } from 'node:net';
import next from 'next';

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? '127.0.0.1';
const FORWARDING = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip'];

const normalize = (ip) => (ip ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
const trusted = new BlockList();
for (const entry of (process.env.PANEL_TRUST_PROXY ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const [addr, bits] = entry.split('/');
  const family = isIP(addr) === 6 ? 'ipv6' : isIP(addr) === 4 ? 'ipv4' : null;
  if (!family) throw new Error(`PANEL_TRUST_PROXY: dirección no válida "${entry}"`);
  if (bits) trusted.addSubnet(addr, Number(bits), family); else trusted.addAddress(addr, family);
}
const isTrusted = (ip) => { const f = isIP(ip); return f !== 0 && trusted.check(ip, f === 6 ? 'ipv6' : 'ipv4'); };

/** IP del cliente según la cadena de confianza explícita. Exportada para las pruebas. */
export function clientIp(socketAddress, xffHeader) {
  let ip = normalize(socketAddress);
  const hops = String(xffHeader ?? '').split(',').map((s) => normalize(s.trim())).filter((s) => isIP(s)).reverse();
  for (const hop of hops) {
    if (!isTrusted(ip)) break;
    ip = hop;
  }
  return ip;
}

if (process.env.PANEL_SERVER_NO_LISTEN !== '1') {
  process.env.MC_PANEL_SERVER = '1';   // next.config.ts rechaza arrancar en producción sin esta marca
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  createServer((req, res) => {
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']);
    for (const h of FORWARDING) delete req.headers[h];
    req.headers['x-forwarded-for'] = ip;
    handle(req, res);
  }).listen(port, hostname, () => {
    console.log(`panel en http://${hostname}:${port} · proxies de confianza: ${process.env.PANEL_TRUST_PROXY || 'ninguno'}`);
  });
}
