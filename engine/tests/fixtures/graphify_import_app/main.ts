import { Counter, twice } from "./util";

export function run(n: number): number {
  const counter = new Counter();
  return twice(n) + counter.increment(n);
}
