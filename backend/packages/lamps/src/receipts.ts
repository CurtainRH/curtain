import { verifyTypedData, type Address, type Hex } from "viem";
import type { LampsReceiptVerifier, SignedLampsReceipt } from "./index";

export interface LampsReceiptIdentity {
  chainId: number;
  verifyingContract: Address;
  hostAddress(hostId: string): Promise<Address | undefined>;
}

/** EIP-712 receipt verification. Host identity resolution remains under the integrator's control. */
export function eip712ReceiptVerifier(identity: LampsReceiptIdentity): LampsReceiptVerifier {
  return {
    async verify(input: SignedLampsReceipt): Promise<boolean> {
      const signer = await identity.hostAddress(input.hostId);
      if (!signer) return false;
      try {
        return await verifyTypedData({
          address: signer,
          domain: { name: "LampsReceipt", version: "1", chainId: identity.chainId, verifyingContract: identity.verifyingContract },
          types: {
            UsageReceipt: [
              { name: "reservationId", type: "string" },
              { name: "hostId", type: "string" },
              { name: "boothsRequestId", type: "string" },
              { name: "startedAt", type: "string" },
              { name: "finishedAt", type: "string" },
              { name: "resultHash", type: "bytes32" },
              { name: "usageSeconds", type: "uint64" },
            ],
          },
          primaryType: "UsageReceipt",
          message: {
            reservationId: input.reservationId,
            hostId: input.hostId,
            boothsRequestId: input.receipt.boothsRequestId,
            startedAt: input.receipt.startedAt,
            finishedAt: input.receipt.finishedAt,
            resultHash: input.receipt.resultHash as Hex,
            usageSeconds: BigInt(input.receipt.usageSeconds),
          },
          signature: input.signature,
        });
      } catch {
        return false;
      }
    },
  };
}
