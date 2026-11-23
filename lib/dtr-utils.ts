/** Convert hours + minutes to decimal using 0.1 = 6 minute increments (ceiling). */
export function toDecimal(h: number, m: number): number {
  return h + (m > 0 ? Math.ceil(m / 6) / 10 : 0);
}
