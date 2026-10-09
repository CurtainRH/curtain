declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(input: unknown, wasm: string, zkey: string): Promise<{ proof: any; publicSignals: string[] }>;
  };
}
