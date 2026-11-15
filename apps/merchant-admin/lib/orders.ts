export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' }> = {
  pending: { label: 'Pendiente de pago', tone: 'warning' },
  paid: { label: 'Pagado · por enviar', tone: 'info' },
  fulfilled: { label: 'Enviado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
  refunded: { label: 'Reembolsado', tone: 'danger' },
};
export const formatDate = (iso: string) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
