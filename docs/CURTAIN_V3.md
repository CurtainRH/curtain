# Curtain V3

Curtain V3 is a separate fixed-denomination vault. Curtain V2 remains available for flexible amounts and existing tickets.

V3 currently approves 1, 10, and 100 whole units for supported assets, and 100, 1,000, and 10,000 USDG. The owner can change the allowlist on-chain, but the product should expose only denominations configured in the V3 operator.

V3 also commits the payout tag before the deposit exists. A refund reserves that tag, which prevents a later settlement from racing a refund. V3 does not redistribute settlement surplus pro-rata; surplus goes to treasury. The 180-day delay limit remains an operator policy, not a vault rule.

## Deployment

- V2: `deployments/4663.json`
- V3: `deployments/4663-v3.json`
- V3 vault: `0xBF643c56D6f1775f9ABe97b7B7e89b0265D6c67a`

The existing operator and keeper now serve both vaults. Keep `VAULT_ADDR` pointed at V2, add `V3_VAULT_ADDR`, a separate `V3_DATABASE_URL`, `V3_START_BLOCK`, and provide `V3_FIXED_AMOUNTS_JSON` with raw token amounts, for example:

Set `V3_FIXED_AMOUNTS_JSON=default` to load the deployed policy automatically using each token's on-chain decimals. You can instead provide a JSON object of raw amounts for a custom policy.

The frontend uses the same operator URL with an `X-Curtain-Version` request header and uses `VITE_V3_VAULT_ADDR` for its trusted vault address.
