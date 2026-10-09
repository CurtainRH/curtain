declare module "circomlibjs" {
  interface Poseidon {
    F: { toObject(value: unknown): bigint };
    (inputs: bigint[]): unknown;
  }
  export function buildPoseidon(): Promise<Poseidon>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: string, zkey: string): Promise<{ proof: any; publicSignals: string[] }>;
  };
}
