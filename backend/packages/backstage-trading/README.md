# Backstage private trading — experimental

`@curtain/backstage-trading` is cloneable, in-process policy code for preparing screened trading routes from an integrator-controlled account or pool. It validates canonical listings, exact-transfer behavior, asset age, liquidity, venue approval, and size caps before calling an integrator-provided venue adapter for an unsigned route.

This package is not a DEX, broker, launch platform, custodian, private relay, price oracle, or transaction executor. Asset metadata, liquidity, transfer behavior, and venue routes must be independently verified by the integrator. The returned route is unsigned; users or the integrating smart-account system review, sign, and execute it separately.

Store implementations must atomically de-duplicate request IDs and reconcile venue/chain failures. A successful `prepare` call is not a fill, liquidity guarantee, price guarantee, or proof that an action is private.

Run `bun run --filter @curtain/backstage-trading test` and `bun run --filter @curtain/backstage-trading typecheck` from `backend`.
