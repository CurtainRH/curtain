declare module "bun:test" {
  export function describe(name: string, run: () => void): void;
  export function test(name: string, run: () => void): void;
  export function expect<T>(value: T): {
    toBe(expected: T): void;
  };
}
