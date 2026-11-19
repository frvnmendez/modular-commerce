/**
 * Las tiendas en su subdominio se sirven internamente como /tienda/~<slug>/… (proxy.ts). La marca «~» le dice
 * al escaparate que sus enlaces no llevan el prefijo /tienda/<slug>. (Las cabeceras de la petición no sirven
 * para esto: Next las rehace en las reescrituras internas.)
 */
export function splitSlug(raw: string) {
  const v = decodeURIComponent(raw);
  const sub = v.startsWith('~');
  const slug = sub ? v.slice(1) : v;
  return { slug, sub, base: sub ? '' : `/tienda/${slug}` };
}
