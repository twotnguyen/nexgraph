export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

export function formatSum(total: number): string {
  return `sum=${total}`;
}
