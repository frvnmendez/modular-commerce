import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tiendas en su subdominio (Hito 2): <slug>.PLATFORM_DOMAIN/… se sirve internamente como /tienda/<slug>/….
 * - En un subdominio de tienda solo existe la tienda: las rutas del panel redirigen al dominio principal,
 *   así las cookies de sesión del panel nunca viajan a un subdominio de tienda.
 * - Se reescribe a /tienda/~<slug>/…: la marca «~» le dice al escaparate que sus enlaces no llevan el prefijo
 *   /tienda/<slug> (lib/slug.ts).
 * Sin PLATFORM_DOMAIN no hace nada (las tiendas viven en /tienda/<slug>).
 */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const PASS = /^\/(?:public|media|_next)\/|^\/favicon\.ico$/;
const PANEL = /^\/(?:stores|login|onboarding|platform|invitations|api|v1)(?:\/|$)/;

export function proxy(req: NextRequest) {
  const domain = process.env.PLATFORM_DOMAIN?.trim().toLowerCase();
  const host = (req.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!domain || host === domain || host === `www.${domain}` || !host.endsWith(`.${domain}`)) {
    return NextResponse.next();
  }
  const slug = host.slice(0, -domain.length - 1);
  if (!SLUG.test(slug)) return new NextResponse('Tienda no encontrada', { status: 404 });
  const path = req.nextUrl.pathname;
  if (PASS.test(path)) return NextResponse.next();
  const main = `${req.nextUrl.protocol}//${domain}${req.nextUrl.port ? `:${req.nextUrl.port}` : ''}`;
  if (PANEL.test(path)) return NextResponse.redirect(new URL(path + req.nextUrl.search, main));
  // La ruta interna /tienda/<slug>/… también llega aquí (el router de Next la usa en sus peticiones internas
  // tras la reescritura): se sirve tal cual. La de otra tienda, no.
  const own = [`/tienda/${slug}`, `/tienda/~${slug}`, `/tienda/%7E${slug}`, `/tienda/%7e${slug}`];
  if (own.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (path.startsWith('/tienda/')) return new NextResponse('No encontrado', { status: 404 });
  const url = req.nextUrl.clone();
  url.pathname = `/tienda/~${slug}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: '/((?!_next/static|_next/image).*)' };
