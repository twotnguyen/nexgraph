import { Calculator, formatSum } from "@demo/mathlib";

export function checkout(prices: number[]): string {
  const calc: Calculator = new Calculator();
  let total = 0;
  for (const p of prices) {
    total = calc.add(total, p);
  }
  return formatSum(total);
}
