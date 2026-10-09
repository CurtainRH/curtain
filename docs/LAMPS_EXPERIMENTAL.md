# Lamps — experimental reserved GPU windows

Lamps is the reservation and settlement layer planned around Booths. A Lamp is a specific GPU service window with a stated hardware class, region, capacity, start/end time, supported workloads, and price—not an interchangeable token balance.

The current cloneable package at `backend/packages/lamps` is an in-process state-machine prototype. It models offers, capacity reservations, host acceptance, Booths-linked delivery receipts, buyer confirmation/dispute, and no-show refund eligibility. It does not persist data, custody funds, execute escrow, verify receipt signatures, or prove a host ran the promised hardware.

Clone `https://github.com/CurtainRH/curtain`, then from `backend/` run `bun install`, `bun run --filter @curtain/lamps test`, and `bun run --filter @curtain/lamps typecheck`. The [package README](../backend/packages/lamps/README.md) explains integration and remaining work. Do not treat the prototype's state transitions as payments or refunds.
