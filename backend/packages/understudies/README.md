# Understudy accounts — experimental

`@curtain/understudies` is cloneable, in-process policy code for one-purpose smart accounts. It validates a purpose-bound account policy, asks an integrator-owned authorizer to verify user-controlled approval, delegates account provisioning to an integrator adapter, and authorizes only the approved venue/action/asset/amount/gas combinations until expiry.

The toolkit never accepts, derives, stores, or signs with a shielded/private key. `controllerReference` and `recoveryReference` are opaque identifiers in the integrator's own deterministic key/account-recovery system. The provisioner supplies the actual smart-account implementation, chain, deployment, and public account reference.

## Boundaries

- It is not an account provider, wallet, relayer, gas sponsor, custody system, or transaction executor.
- `authorize` produces a policy authorization record, not a signed or broadcast transaction.
- Gas funding is optional and adapter-provided. The caller chooses the funding source and must reconcile any balance/chain failure.
- Store implementations must atomically make account IDs and action request IDs unique and reserve usage limits; retries must return the prior action rather than spending twice.

## Use

```ts
import { createUnderstudyToolkit } from "@curtain/understudies";

const understudies = createUnderstudyToolkit({
  store: yourAtomicStore,
  authorizer: yourOwnerAndRecoveryVerifier,
  provisioner: yourSmartAccountAndGasAdapter,
});

const account = await understudies.create(policy, ownerApproval);
const action = await understudies.authorize(actionRequest);
```

Run `bun run --filter @curtain/understudies test` and `bun run --filter @curtain/understudies typecheck` from `backend`.
