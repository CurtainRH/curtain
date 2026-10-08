# Curtain developer documentation frontend

This directory is a standalone Vite site, deployed separately at `docs.curtainrh.com`.
Existing Markdown product specifications and deployment documents remain here unchanged.
Only `index.html`, its referenced `src/` assets, and `public/` are published in `dist/`.

## Local development

```sh
npm ci --prefix docs
npm run dev --prefix docs
npm run build --prefix docs
```

## Vercel

Create a separate project using the private repo, branch `main`:

- Root Directory: `docs`
- Framework: Vite
- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- Domain: `docs.curtainrh.com`

No environment variables or API keys are needed for this static documentation site.
It does not make authenticated API calls or offer a browser API-key playground.

## Developer API deployment

The existing operator serves `/developer/*` for wallet-signature key management and
`/v1/*` for authenticated V2 and V3 integration. `005_developer_api.sql` and
`006_developer_v3_intents.sql` are applied by the operator's existing startup migration.
API keys use the main database; V2 and V3 intent ownership maps live with their respective
operator databases.
`007_integrator_fees.sql` adds the optional Developer API integrator-fee fields to intents.
`008_limit_orders.sql` adds explicit limit-order intent metadata; limit orders reuse the existing
on-chain `minOut` settlement guard and accept `orderType: "limit"` plus `expiresInSeconds`.
No new operator, keeper, or main frontend environment variables are required.
Deploy the backend before the main dashboard. The keeper and vault contracts are unchanged.

Dashboard management uses the existing same-origin `/api/curtain/developer/*` proxy.
Third-party backends call `https://operator.curtainrh.com/v1` with a Bearer API key.
Stealth/split parameters and smart-contract wallet authentication are not supported by this
first developer release. Key-specific limits persist in PostgreSQL across restarts.

## MCP for agents

The operator also serves a Streamable HTTP MCP endpoint at `https://operator.curtainrh.com/mcp`.
Connect an MCP-compatible agent with a Curtain Developer API key as its Bearer credential. The
server exposes configuration, quotes, Dynamic Privacy route selection, unsigned swap preparation,
intent status, and public keeper discovery. User deposits are never signed or broadcast by MCP;
the returned approval and deposit transactions must be reviewed and signed by the user's wallet.
Developer API integrators may include an `integratorFee` with a recipient and basis-point rate up
to 100 bps. The fee is deducted from the quoted output and paid as a separate settlement payout.

Keeper integrations use the public `GET /keeper/v1/settlements/pending?privacyRoute=v2` or
`privacyRoute=v3` feed. It returns operator-signed settlements plus the chain and vault address;
any funded wallet can submit each settlement directly to the returned vault and receive its keeper
fee. No API key is required. The legacy `/settlements/pending` endpoint remains available for
existing keepers.

Security checks: `cd backend && bun test services/operator/test/developer.test.ts`.
