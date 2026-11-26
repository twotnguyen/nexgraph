export function add(a: number, b: number): number {
  return a + b;
}

export function twice(a: number): number {
  return add(a, a);
}

export function triple(a: number): number {
  return add(a, add(a, a));
}

export class Counter {
  private value = 0;

  increment(step: number): number {
    this.value = add(this.value, step);
    return this.value;
  }
}
