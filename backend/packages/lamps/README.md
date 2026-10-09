# Lamps booking protocol — experimental

Lamps is the booking layer around Booths. A Lamp represents capacity on a **specific, fixed UTC service window** for a named GPU class—not a fungible GPU-hour balance. A host publishes the window and its Booths provider capabilities; a buyer reserves one capacity unit; the host accepts and runs a Booths job during that window; the host submits a usage receipt; and the buyer confirms or disputes delivery.

This cloneable package is an in-process protocol/state-machine prototype. It is not a hosted API, persistent marketplace, smart contract, escrow, token, payment processor, or proof that the receipt describes correct execution. It does not move funds. Do not represent a `refunded` state from this prototype as an actual token refund.

## Clone and test

```sh
git clone https://github.com/CurtainRH/curtain.git
cd curtain/backend
bun install
bun run --filter @curtain/lamps test
bun run --filter @curtain/lamps typecheck
```

## Use in your service

In a monorepo, add `backend/packages/booths` and `backend/packages/lamps` as workspace packages, or vendor their source. Lamps uses Booths capabilities to ensure an offer only lists devices and tasks the host provider advertises. `devices` is per schedulable accelerator; repeated device names mean multiple GPUs of the same class, and offer capacity cannot exceed that count.

```ts
import { createLampsBook, type LampsOffer } from "@curtain/lamps";

const book = createLampsBook();
const offer: LampsOffer = {
  id: "offer-a10-2030-01-01-12z",
  hostId: "host-operator-1",
  gpuClass: "NVIDIA A10",
  region: "us-west",
  startsAt: "2030-01-01T12:00:00.000Z",
  endsAt: "2030-01-01T14:00:00.000Z",
  capacity: 1,
  priceAsset: "USDG",
  priceAmount: "25000000",
  tasks: ["inference"],
};

book.publish(offer, await boothsProvider.capabilities());
const reservation = book.reserve(offer.id, "buyer-1", "checkout-123");
```

All timestamps must be canonical ISO UTC; windows must be future, positive, and whole-hour duration. Price is currently descriptive metadata only. `reserve` is idempotent per buyer/request ID and enforces the offer's capacity. The lifecycle methods enforce host/buyer roles and the receipt's link to a Booths request ID.

## What remains before escrow or a marketplace

- Durable storage, signed host offers, and cross-process reservation locking.
- A receipt signature/verification format and a meaningful way to dispute incorrect or partial work.
- The payment asset and exact commercial definition of a window/capacity unit.
- Audited escrow contracts with explicit acceptance, seller non-delivery, buyer dispute, timeout, and refund paths.
- Host onboarding, availability monitoring, cancellation policy, and real hardware/benchmark verification.

The unit tests use a mock provider and fake clock. They validate the protocol only; they do not test GPU execution, payment, chain settlement, seller reliability, or contractual enforceability.
