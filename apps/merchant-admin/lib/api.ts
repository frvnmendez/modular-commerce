'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) { super(code); }
}

/** Mensajes para los motivos concretos que devuelve la API en `detail`. */
const DETAILS: Record<string, string> = {
  OUT_OF_STOCK: 'No queda stock suficiente de algún producto del carrito. Revisa las cantidades.',
  QUANTITY_LIMIT: 'Puedes comprar como máximo 20 unidades de cada producto.',
  VARIANT_NOT_FOUND: 'Algún producto del carrito ya no está disponible. Quítalo e inténtalo de nuevo.',
  CURRENCY_LOCKED: 'No puedes cambiar la moneda cuando ya tienes productos: sus precios están en la moneda actual.',
  VARIANT_HAS_ORDERS: 'Esa opción ya tiene pedidos y no se puede borrar. Puedes dejarla sin stock.',
  PRODUCT_HAS_ORDERS_ARCHIVE_INSTEAD: 'Este producto tiene pedidos y no se puede borrar. Archívalo para ocultarlo.',
  DUPLICATE: 'Ya hay otro producto con esa dirección web o ese SKU. Cámbialo.',
  TOO_MANY_IMAGES: 'Cada producto admite hasta 10 fotos.',
  UNSUPPORTED_IMAGE: 'La foto debe ser JPG, PNG o WebP.',
  IMAGE_TYPE_REQUIRED: 'La foto debe ser JPG, PNG o WebP.',
  TOO_LARGE: 'La foto pesa demasiado (máximo 5 MB).',
  COMPARE_AT_NOT_HIGHER: 'El precio «antes» debe ser mayor que el precio actual.',
  ORDER_NOT_PAID: 'Solo se pueden enviar pedidos pagados.',
  ORDER_NOT_REFUNDABLE: 'Este pedido no se puede reembolsar en su estado actual.',
  REFUND_UNAVAILABLE: 'No se pudo reembolsar automáticamente. Hazlo desde tu panel de Stripe.',
  ONLY_UNPAID_ORDERS_CAN_BE_CANCELLED: 'Solo se pueden cancelar pedidos sin pagar. Para uno pagado, reembólsalo.',
  PAYMENTS_NOT_READY: 'Esta tienda todavía no puede cobrar. Vuelve a intentarlo más tarde.',
  SLUG_RESERVED: 'Esa dirección está reservada por la plataforma. Elige otra.',
  CONNECT_DISABLED: 'Los cobros con cuenta propia no están activados en esta plataforma.',
  ACCOUNT_NOT_READY: 'Termina primero el alta en Stripe.',
  REQUIRES_OWNER_OR_ADMIN: 'Solo un propietario o administrador puede hacer esto.',
};

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  EMAIL_NOT_VERIFIED: 'Verifica tu email antes de continuar.',
  NOT_FOUND: 'No encontramos lo que buscas o no tienes acceso.',
  FORBIDDEN: 'Tu rol no permite esta acción. Pide acceso a un propietario de la tienda.',
  CONFLICT: 'Ya existe o entra en conflicto con otro elemento. Revisa los datos.',
  VALIDATION: 'Revisa los campos marcados.',
  INTERNAL: 'Algo ha fallado por nuestra parte. Inténtalo de nuevo en unos minutos.',
  RATE_LIMITED: 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.',
  PAYMENT_UNAVAILABLE: 'El pago no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.',
  BAD_REQUEST: 'Revisa los datos del formulario.',
};

export const humanError = (e: unknown) =>
  e instanceof ApiError ? (e.detail && DETAILS[e.detail]) || MESSAGES[e.code] || `Error ${e.status}` : 'No hay conexión con el servidor.';

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; file?: File } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  // Las acciones POST sin datos mandan {} (la API exige JSON en toda escritura como defensa CSRF).
  const body = init.body ?? (method === 'POST' && !init.file ? {} : undefined);
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: init.file ? { 'content-type': init.file.type } : body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.file ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? data.code ?? 'INTERNAL', data.detail);
  return data as T;
}

export type Me = {
  user: { id: string; email: string; name: string };
  organizations: { id: string; name: string; role: string }[];
  stores: { id: string; orgId: string; name: string; slug: string; role: string }[];
  platformOperator: boolean;
};
