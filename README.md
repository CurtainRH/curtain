![Curtain center stage](public/center-stage-clean.png)

# Curtain ($CRTN)

![CI](https://github.com/CurtainRH/curtain/actions/workflows/backend.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-React_19-FF4154?logo=react&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-0.8.26-363636?logo=solidity&logoColor=white)
![Robinhood Chain](https://img.shields.io/badge/Robinhood_Chain-4663-CCFF00)

Private swaps and stake-to-earn on Robinhood Chain. Swap USDG and tokenized Stock Tokens without a direct wallet-to-recipient edge, instantly or on a random delay you choose, with an escape hatch that returns your deposit if Curtain can't pay. Tagline: *Draw the curtain.*

**$CRTN Contract address:** `0x66a844fcbf4705dbde3c97394d5a4c9822e8f35b`

**Stock-bundle staking contract:** `0xfabeaf10dd71f269b774c7e69aff52216b1a7a4c`

**Curtain privacy routes on Robinhood Chain:**

- V2 flexible vault: `0xF9381841e982648c178E762116A437Ecbcf12Bbd`
- V3 fixed-denomination vault: `0xBF643c56D6f1775f9ABe97b7B7e89b0265D6c67a`
- Shielded-pool route (internally Pool V2): paused while a revised deployment is prepared

V2 is for flexible amounts. V3 is for fixed denominations—1, 10, and 100 whole units for supported assets, with USDG supporting 10, 100, 1,000, and 10,000 units. The shielded-pool route is not currently available in the dashboard, Swap app, or operator API.

## Features

| Feature | What it does |
|---|---|
| Private swap | Deposit token X into the Curtain vault; token Y arrives at the address you choose. The vault does not store a direct deposit-to-recipient mapping, but public amounts can allow statistical correlation in low-volume batches. |
| Instant or delayed | Paid right away, or at a random time inside a window you pick (up to 180 days). The maximum delay is enforced by the operator service, not by the vault contract. |
| Limit orders | Set a minimum received amount and expiry; the operator waits for a qualifying quote, while the existing escape hatch protects the deposit if the target is not reached. |
| Escape hatch | If a swap isn't paid by its deadline, you can take your deposit back 3 minutes later. |
| Open keepers | Anyone can submit signed payouts and earn a small fee. |
| CRTN stock-bundle staking | Lock CRTN for 30 / 90 / 180 days at a 4% base APR, scaled by 1× / 1.5× / 2×. Rewards are valued in USDG when staked, stop accruing at maturity, and are paid in the selected stock bundle when claimed. Pool inventory can temporarily delay claims; accrued rewards remain available. |
| Lending | Morpho integration, after launch. |
| Developer API | Create and revoke API keys in Dashboard → Developer. V2 flexible, V3 fixed-denomination, and dynamic route selection, with idempotent intents, unsigned wallet transactions, per-key intent status, and optional integrator fees up to 1%. |
| MCP for agents | Connect an MCP-compatible agent at `https://operator.curtainrh.com/mcp` for quotes, Dynamic Privacy, unsigned swap preparation, status, and keeper discovery. |

Developer documentation frontend: [`docs/README.md`](docs/README.md), intended for [docs.curtainrh.com](https://docs.curtainrh.com). API keys are server-side credentials; users still sign and fund their own deposits.

## How it works

1. **Intent:** the app asks the operator for a swap (output token, recipient, minimum output, delay). The user gets an escape ticket.
2. **Deposit:** the user deposits into `CurtainVault`. On-chain this shows only the deposit, not where it's going.
3. **Swap:** at the scheduled time, the operator batches deposits and swaps inside the vault through Uniswap.
4. **Payout:** the operator signs a payout; any keeper submits it. Recipient details are not stored in the deposit, although public amounts may be correlatable.
5. **Refund if needed:** after the deadline plus 3 minutes, an unpaid deposit can be refunded. The current V2 vault uses a 1-hour challenge window for already-paid deposits.

## Fees

| | Fee |
|---|---|
| Swap | 0.20% of the output |
| Keeper | 0.05% of the output (covers gas) |
| DEX | Uniswap pool fee |

## Repo structure

```
/                     frontend: Curtain site (TanStack Start + Vite + Tailwind), deployed by Vercel/Lovable
├─ src/               app routes, Curtain experience (src/curtain), shadcn/ui components
├─ public/
├─ backend/           Bun workspace — see backend/README.md
│  ├─ contracts/      Foundry: CurtainVault, CurtainStaking, CRTN, stealth addresses
│  ├─ packages/       sdk (client + ABIs), db (Postgres + migrations)
│  ├─ services/       operator, keeper, multiplier-view
│  ├─ db/migrations/  operator schema
│  ├─ scripts/        devnet.ts (anvil + Deploy.s.sol for e2e tests)
│  └─ Dockerfile      operator / keeper image
├─ docs/              standalone developer docs frontend + preserved product specs and repo sync guide
├─ scripts/           sync-public.py
└─ .github/workflows/ backend CI
```

## Getting started

Requires [Bun](https://bun.sh) ≥ 1.4, [Foundry](https://getfoundry.sh), and Docker (for local Postgres).

```bash
git clone --recurse-submodules https://github.com/CurtainRH/curtain.git
cd curtain

# Frontend
cp .env.example .env
bun install
bun run dev

# Backend
cd backend
cp .env.example .env
bun install
bun run test                   # all tests, incl. e2e on a local anvil chain
cd contracts && forge test     # contracts
```

## Operator API

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ status }` |
| GET | `/config` | vault, tokens, keeper fee, max delay |
| POST | `/intents` | `{ id, deadline, salt, deadlineHash, vault }` |
| GET | `/intents/:id` | status, deposit id, output, payout tx |
| GET | `/keeper/v1/settlements/pending?privacyRoute=v2|v3` | public signed settlements any keeper may submit; response includes vault and chain metadata |

## Roadmap

| Phase | Scope |
|---|---|
| MVP | Private swap (vault + operator + keepers), stake-to-earn, SDK |
| Launch | $CRTN token, deploy to Robinhood Chain, move admin/operator keys to multisig/MPC |
| After launch | Morpho lending |

## Tech stack

Solidity 0.8.26 + Foundry · Bun + TypeScript · Postgres · viem · Uniswap · React 19 + TanStack Start + Tailwind v4 + shadcn/ui · GSAP

## License


[MIT](LICENSE)
