/**
 * Cálculo de importes del spike. Todo en unidades menores con BigInt: nunca float.
 * Redondeo: mitad al par (bancario) una sola vez por pedido, sobre el total, no línea a línea.
 */

/** Divide a/b redondeando a la mitad al par. a >= 0, b > 0. */
export function divRoundHalfEven(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new RangeError('divRoundHalfEven: a >= 0 y b > 0');
  const q = a / b;
  const r = a % b;
  const twice = r * 2n;
  if (twice > b) return q + 1n;
  if (twice < b) return q;
  return q % 2n === 0n ? q : q + 1n;
}

export type Line = { unitPrice: bigint; quantity: number };
export type Totals = { subtotal: bigint; taxTotal: bigint; total: bigint; lines: bigint[] };

/**
 * Totales de un pedido.
 *  - Precios con impuesto incluido (B2C UE): total = subtotal; impuesto = subtotal - subtotal / (1 + tipo).
 *  - Precios sin impuesto: impuesto = subtotal × tipo; total = subtotal + impuesto.
 */
export function orderTotals(lines: Line[], rateBp: number, pricesIncludeTax: boolean): Totals {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) throw new RangeError('rateBp fuera de rango');
  const lineTotals = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError('cantidad inválida');
    if (l.unitPrice < 0n) throw new RangeError('precio negativo');
    return l.unitPrice * BigInt(l.quantity);
  });
  const subtotal = lineTotals.reduce((a, b) => a + b, 0n);
  const bp = BigInt(rateBp);
  if (pricesIncludeTax) {
    const net = divRoundHalfEven(subtotal * 10000n, 10000n + bp);
    return { subtotal, taxTotal: subtotal - net, total: subtotal, lines: lineTotals };
  }
  const taxTotal = divRoundHalfEven(subtotal * bp, 10000n);
  return { subtotal, taxTotal, total: subtotal + taxTotal, lines: lineTotals };
}
