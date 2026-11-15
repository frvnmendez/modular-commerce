import { describe, expect, it } from 'vitest';
import { divRoundHalfEven, orderTotals } from '../src/money.ts';

/** PRNG determinista (mulberry32) para que las pruebas de propiedades sean reproducibles. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('redondeo mitad al par', () => {
  it('casos frontera', () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);   // 2,5 → 2
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);   // 3,5 → 4
    expect(divRoundHalfEven(1n, 3n)).toBe(0n);
    expect(divRoundHalfEven(2n, 3n)).toBe(1n);
    expect(divRoundHalfEven(0n, 7n)).toBe(0n);
    expect(() => divRoundHalfEven(-1n, 2n)).toThrow();
  });
});

describe('totales de pedido', () => {
  it('IVA incluido 21 %: 3 × 19,99 €', () => {
    const t = orderTotals([{ unitPrice: 1999n, quantity: 3 }], 2100, true);
    // 59,97 / 1,21 = 49,5619… → base 49,56; IVA 10,41
    expect(t).toMatchObject({ subtotal: 5997n, taxTotal: 1041n, total: 5997n });
  });
  it('sin IVA incluido 21 %: 100,00 € + 21,00 €', () => {
    expect(orderTotals([{ unitPrice: 10000n, quantity: 1 }], 2100, false)).toMatchObject({ subtotal: 10000n, taxTotal: 2100n, total: 12100n });
  });
  it('tipo 0 % y varias líneas', () => {
    expect(orderTotals([{ unitPrice: 1n, quantity: 3 }, { unitPrice: 250n, quantity: 2 }], 0, true)).toMatchObject({ subtotal: 503n, taxTotal: 0n, total: 503n, lines: [3n, 500n] });
  });
  it('rechaza cantidades y tipos inválidos', () => {
    expect(() => orderTotals([{ unitPrice: 100n, quantity: 0 }], 2100, true)).toThrow();
    expect(() => orderTotals([{ unitPrice: 100n, quantity: 1.5 }], 2100, true)).toThrow();
    expect(() => orderTotals([{ unitPrice: 100n, quantity: 1 }], 10001, true)).toThrow();
  });

  it('propiedades (5.000 pedidos aleatorios): cuadran al céntimo y el error de redondeo es ≤ 0,5 céntimos', () => {
    const r = rng(20261109);
    for (let k = 0; k < 5000; k++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({ unitPrice: BigInt(Math.floor(r() * 5_000_000)), quantity: 1 + Math.floor(r() * 50) }));
      const bp = [0, 400, 500, 1000, 2000, 2100, 2300, 2700][Math.floor(r() * 8)]!;
      const incl = r() < 0.5;
      const t = orderTotals(lines, bp, incl);
      const subtotal = lines.reduce((a, l) => a + l.unitPrice * BigInt(l.quantity), 0n);
      expect(t.subtotal).toBe(subtotal);
      expect(t.lines.reduce((a, b) => a + b, 0n)).toBe(subtotal);
      expect(t.taxTotal >= 0n).toBe(true);
      // Valor exacto en racionales: comparar |tax·D − N| ≤ D/2 sin pasar por float.
      const [N, D] = incl ? [subtotal * BigInt(bp), 10000n + BigInt(bp)] : [subtotal * BigInt(bp), 10000n];
      const diff = t.taxTotal * D - N;
      expect((diff < 0n ? -diff : diff) * 2n <= D).toBe(true);
      expect(t.total).toBe(incl ? subtotal : subtotal + t.taxTotal);
    }
  });
});
