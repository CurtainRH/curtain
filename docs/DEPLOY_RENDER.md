# Deploying Curtain (Robinhood Chain mainnet + Render)

Two parts: deploy the contracts once from your machine, then run the operator, keeper bot and Postgres on Render using the pre-built GHCR Docker image (`ghcr.io/curtainrh/curtain-operator`).

## 0. Wallets you need

Create four wallets. They must all be different.

| Wallet | Used for | Needs ETH on Robinhood Chain? |
|---|---|---|
| Deployer | Running the deploy script once | Yes, about 0.01 ETH |
| Admin | Owns the vault and staking (allowlists, operator rotation, fee, pause) | A little, for admin transactions |
| Operator | Signs settlements, challenges double-refunds, runs its own keeper | Yes, keep at least 0.02 ETH topped up |
| Keeper | Lands settlements for the keeper fee | Yes, a little |

The treasury can be any address you control.

Keep the admin key offline. The operator and keeper keys go into Render as secrets.

## 1. Deploy the contracts

From `backend/contracts`, with Foundry installed:

```bash
export PRIVATE_KEY=0x...            # deployer
export ADMIN_ADDR=0x...
export OPERATOR_ADDR=0x...
export TREASURY_ADDR=0x...
export DEX_ROUTER_ADDR=0xcaf681a66d020601342297493863e78c959e5cb2   # Uniswap SwapRouter02 on Robinhood Chain
export V4_POOL_MANAGER_ADDR=0x8366a39cc670b4001a1121b8f6a443a643e40951   # Uniswap v4 PoolManager (deploys the v4 adapter)
export TOKEN_ADDRS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,0x322F0929c4625eD5bAd873c95208D54E1c003b2d,0x117cc2133c37B721F49dE2A7a74833232B3B4C0C,0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
#                   USDG,                                         NVDA,                                         TSLA,                                         SPY,                                          QQQ

forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --slow
```

- The script refuses to run on mainnet with a missing address, or with a token or router that has no code.
- It writes `deployments/4663.json` with the vault, staking, v4 adapter and token addresses. Commit that file.
- Note the block number of the deployment transaction. That's `START_BLOCK` below.
- If `ADMIN_ADDR` differs from the deployer, the script starts a two-step ownership transfer of the vault. The admin must call `acceptOwnership()` on the vault to finish it. Staking is owned by the admin from the start.

## 2. Deploy using Container Images (Render)

Both the operator and keeper run from the unified Docker image published to GitHub Container Registry:
```
ghcr.io/curtainrh/curtain-operator:latest
```

### Step 1: Create Postgres Database
In Render Dashboard: **New → PostgreSQL**
- **Name**: `curtain-db`
- **Database**: `curtain`
- **User**: `curtain`
- **Plan**: Starter or Standard (includes daily backups)
- Copy the **Internal Database URL** (`postgres://...`).

### Step 2: Create Operator (Web Service)
In Render Dashboard: **New → Web Service → Existing Image**
- **Image URL**: `ghcr.io/curtainrh/curtain-operator:latest`
- **Name**: `curtain-operator`
- **Health Check Path**: `/health`
- **Environment Variables**:
  - `DATABASE_URL`: Internal Connection String from `curtain-db`
  - `CHAIN_ID`: `4663`
  - `RPC_HTTP`: Dedicated Robinhood Chain RPC URL
  - `OPERATOR_PRIVATE_KEY`: The operator wallet private key
  - `VAULT_ADDR`: `vault` address from `deployments/4663.json`
  - `TOKENS`: *(Optional)* Custom token map as JSON. If omitted, defaults to all 45 verified Robinhood Chain tokens built into the SDK.
  - `DEX_ROUTER_ADDR`: `0xcaf681a66d020601342297493863e78c959e5cb2`
  - `UNISWAP_QUOTER_ADDR`: `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`
  - `ROUTE`: `uniswap`
  - `V4_ADAPTER_ADDR`: `v4Adapter` from `deployments/4663.json`
  - `V4_QUOTER_ADDR`: `0x8dc178efb8111bb0973dd9d722ebeff267c98f94`
  - `SLIPPAGE_BPS`: `50`
  - `KEEPER_FEE_BPS`: `5`
  - `TICK_MS`: `5000`
  - `START_BLOCK`: Deployment block of the vault
  - `POOL_V2_ADDR`: `0x38147c547cDE831812CD075166E279B77FF164Cc` (product V4 / internal `CurtainPoolV2`)
  - `POOL_V2_ROOT_MANAGER_ADDR`: `0x51E2aCaC1Fe6b1915D7Eafd24b96B7781cd9AFEf`
  - `POOL_V2_START_BLOCK`: `84199146`
  - `MIN_OPERATOR_BALANCE_WEI`: `2000000000000000`

### Step 3: Create Keeper (Background Worker)
In Render Dashboard: **New → Background Worker → Existing Image**
- **Image URL**: `ghcr.io/curtainrh/curtain-operator:latest`
- **Name**: `curtain-keeper`
- **Docker Command**: `bun run --cwd services/keeper start`
- **Environment Variables**:
  - `OPERATOR_API`: `http://curtain-operator:3100` (internal) or `https://<operator>.onrender.com`
  - `CHAIN_ID`: `4663`
  - `RPC_HTTP`: Dedicated Robinhood Chain RPC URL
  - `KEEPER_PRIVATE_KEY`: The keeper wallet private key
  - `VAULT_ADDR`: `vault` address from `deployments/4663.json`
  - `KEEPER_TICK_MS`: `5000`

The standalone Swap client currently keeps the pool route disabled while its updated
browser proving assets complete their own end-to-end release validation. Do not set
this Vercel variable yet:

```text
VITE_ENABLE_POOL_V4=false
```

### Step 4: GitHub Actions Auto-Deploy Hooks (Optional)
In your GitHub Repository **Settings → Secrets and variables → Actions**, add:
- `RENDER_DEPLOY_HOOK_URL` (or `RENDER_OPERATOR_DEPLOY_HOOK_URL`): Deploy hook URL from `curtain-operator` Settings in Render.
- `RENDER_KEEPER_DEPLOY_HOOK_URL` (or `KEEPER_DEPLOY_HOOK_URL`): Deploy hook URL from `curtain-keeper` Settings in Render.

When code is pushed to `main`, GitHub Actions will build the container image and trigger both deploy hooks automatically.

### Step 5: Verification
Check that `https://<operator>.onrender.com/health` returns `{"status":"ok"}`, and `/config` returns the deployed vault address and supported tokens.

## 3. Monitoring

Point an uptime monitor (Render notifications, Better Stack, UptimeRobot) at:

```
https://<operator>.onrender.com/status
```

It returns **503** with a `problems` list when:
- the operator loop stopped ticking
- the operator's ETH is below 0.005
- a deposit is within 3 minutes of its deadline without a landed settlement (its owner is about to refund)
- the chain watcher is more than 200 blocks behind

Alert yourself on any 503.

## 4. Backups and the database

- Render's paid Postgres plans include daily backups. Upgrade the plan as volume grows.
- The database holds the depositor→recipient mapping and the payout secrets used to challenge double refunds. Don't share access to it.

## 5. Staking (after $CRTN launches)

From the admin wallet:
1. `CurtainStaking.setTokens(CRTN, CRTN)`
2. `CRTN.approve(staking, amount)`
3. `CurtainStaking.notifyRewardAmount(amount, durationSeconds)`

Repeat step 3 for each reward period.

## Day-to-day

- Keep the operator and keeper wallets funded with ETH.
- `autoDeploy` is off: deploy new backend versions deliberately, not on every push.
- To pause new deposits, the admin calls `setDepositsPaused(true)`. Settlements and refunds keep working while paused.
