import { headers } from 'next/headers';

/**
 * Lectura del escaparate desde el servidor de Next (SEO y primera carga rápida).
 * Reenvía la IP del comprador que fijó server.mjs para que el límite por IP de la API no la confunda con la del
 * propio panel (la API solo acepta X-Forwarded-For si llega desde TRUST_PROXY, es decir, desde este servidor).
 */
export async function storefrontGet<T>(path: string): Promise<T | null> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const res = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:4000'}${path}`, { cache: 'no-store', headers: xff ? { 'x-forwarded-for': xff } : {} });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Escaparate: ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export type PublicStore = {
  id: string; name: string; slug: string; country: string; currency: string; shippingFlatAmount: number; freeShippingThreshold: number | null;
  contactEmail: string | null; accentColor: string | null; logo: string | null; banner: string | null; headline: string | null; tagline: string | null;
  paymentAccountReady: boolean; acceptsPayments: boolean;
};
export type PublicProductCard = { handle: string; title: string; priceFrom: number; image: string | null; available: boolean };
export type PublicProduct = { handle: string; title: string; description: string; images: string[]; variants: { id: string; title: string; price: number; compareAt: number | null; available: number }[] };
