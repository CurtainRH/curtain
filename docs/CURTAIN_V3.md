# Curtain V3

Curtain V3 is a separate fixed-denomination vault. Curtain V2 remains available for flexible amounts and existing tickets.

V3 currently approves 1, 10, and 100 whole units for supported assets, and 100, 1,000, and 10,000 USDG. The owner can change the allowlist on-chain, but the product should expose only denominations configured in the V3 operator.

V3 also commits the payout tag before the deposit exists. A refund reserves that tag, which prevents a later settlement from racing a refund. V3 does not redistribute settlement surplus pro-rata; surplus goes to treasury. The 180-day delay limit remains an operator policy, not a vault rule.

## Deployment

- V2: `deployments/4663.json`
- V3: `deployments/4663-v3.json`
- V3 vault: `0xBF643c56D6f1775f9ABe97b7B7e89b0265D6c67a`

The V3 operator is a separate service instance. Set `V3_MODE=true`, point `VAULT_ADDR` at the V3 vault, and provide `V3_FIXED_AMOUNTS_JSON` with raw token amounts, for example:

```json
{"USDG":["100000000000000000000","1000000000000000000000","10000000000000000000000"]}
```

The frontend uses `CURTAIN_V3_OPERATOR_URL` for `/api/curtain-v3` and `VITE_V3_VAULT_ADDR` for its trusted vault address.
