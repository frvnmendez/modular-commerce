/** Importes en céntimos (enteros) en todo el sistema. Aquí solo se muestran y se leen de formularios. */
export const formatMoney = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100);

/** «19,99», «19.99», «19» o «1.299,50» → céntimos. Devuelve null si no es un importe válido. */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/\s|€|\$/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

/** Céntimos → texto editable («19,99»). */
export const centsToInput = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
