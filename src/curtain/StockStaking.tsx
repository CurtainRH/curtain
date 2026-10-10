import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  isAddress,
  parseAbi,
  parseAbiItem,
  parseUnits,
  type Address,
} from "viem";
import { Coins, RefreshCw } from "lucide-react";
import { useNav } from "./App";
import { chain, ensureChain, errorMessage, provider, publicClient } from "./integration";

const STAKING = "0x0852E2B555090dFc537207f3cB2d9D936eDa2e7A" as Address;
const CRTN = "0x66A844fcbf4705Dbde3c97394d5a4C9822E8F35b" as Address;
const DEPLOY_BLOCK = 84893551n;
const BUNDLES = [
  {
    id: 1n,
    name: "Market Core",
    assets: [
      { symbol: "SPY", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
      { symbol: "QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
    ],
  },
  {
    id: 2n,
    name: "AI & Chips",
    assets: [
      { symbol: "SMH", address: "0x072f979c2CAc8e1391B0162a87Fee094bF8744a0" },
      { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
      { symbol: "TSM", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA" },
      { symbol: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
    ],
  },
  {
    id: 3n,
    name: "Platform Leaders",
    assets: [
      { symbol: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
      { symbol: "MSFT", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
      { symbol: "AMZN", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
      { symbol: "GOOGL", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
      { symbol: "META", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
    ],
  },
] as const;
const ABI = parseAbi([
  "function stake(uint256 amount,uint8 tierId,uint256 bundleId) returns (uint256)",
  "function positions(uint256) view returns (address owner,uint128 amount,uint128 weighted,uint64 unlockAt,uint32 bundleId,bool closed)",
  "function earned(uint256,address) view returns (uint256)",
  "function withdraw(uint256)",
  "function claimReward(uint256,address,uint256,uint256,bytes)",
  "function totalStaked() view returns (uint256)",
]);
type Position = {
  id: bigint;
  amount: bigint;
  unlockAt: bigint;
  bundleId: bigint;
  closed: boolean;
  rewards: Record<string, bigint>;
};
const tokenAddress = (value: string) => value as Address;
const timeLeft = (unlockAt: bigint) => {
  const seconds = Number(unlockAt) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "Unlocked";
  const days = Math.floor(seconds / 86400);
  return `${days}d ${Math.floor((seconds % 86400) / 3600)}h remaining`;
};

export default function StockStaking() {
  const { wallet, connect } = useNav();
  const [amount, setAmount] = useState("");
  const [bundleId, setBundleId] = useState(1n);
  const [tier, setTier] = useState(0);
  const [balance, setBalance] = useState<bigint>();
  const [decimals, setDecimals] = useState(18);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [totalStaked, setTotalStaked] = useState<bigint>(0n);
  const bundle = BUNDLES.find((item) => item.id === bundleId)!;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const configResponse = await fetch("/api/curtain/staking/config", { cache: "no-store" });
      const config = (await configResponse.json()) as {
        enabled?: boolean;
        staking?: string;
        error?: string;
      };
      setConfigured(
        config.enabled === true && config.staking?.toLowerCase() === STAKING.toLowerCase(),
      );
      if (!configResponse.ok || !config.enabled)
        throw new Error(config.error || "Stock staking is not enabled on the operator yet.");
      if (!wallet || !isAddress(wallet)) {
        setPositions([]);
        return;
      }
      const tokenDecimals = await publicClient.readContract({
        address: CRTN,
        abi: erc20Abi,
        functionName: "decimals",
      });
      setDecimals(tokenDecimals);
      const [tokenBalance, staked, logs] = await Promise.all([
        publicClient.readContract({
          address: CRTN,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet as Address],
        }),
        publicClient.readContract({ address: STAKING, abi: ABI, functionName: "totalStaked" }),
        publicClient.getLogs({
          address: STAKING,
          event: parseAbiItem(
            "event Staked(uint256 indexed positionId,address indexed owner,uint256 indexed bundleId,uint256 amount,uint8 tier,uint64 unlockAt)",
          ),
          args: { owner: wallet as Address },
          fromBlock: DEPLOY_BLOCK,
          toBlock: "latest",
        }),
      ]);
      setBalance(tokenBalance);
      setTotalStaked(staked);
      const unique = [
        ...new Set(
          logs.map((log) => log.args.positionId).filter((id): id is bigint => id !== undefined),
        ),
      ];
      const found = await Promise.all(
        unique.map(async (id) => {
          const p = await publicClient.readContract({
            address: STAKING,
            abi: ABI,
            functionName: "positions",
            args: [id],
          });
          const pBundleId = BigInt(p[4]);
          const b = BUNDLES.find((item) => item.id === pBundleId);
          const rewards: Record<string, bigint> = {};
          if (b)
            await Promise.all(
              b.assets.map(async (asset) => {
                rewards[asset.symbol] = await publicClient.readContract({
                  address: STAKING,
                  abi: ABI,
                  functionName: "earned",
                  args: [id, tokenAddress(asset.address)],
                });
              }),
            );
          return {
            id,
            amount: BigInt(p[1]),
            unlockAt: BigInt(p[3]),
            bundleId: pBundleId,
            closed: p[5],
            rewards,
          };
        }),
      );
      setPositions(found.sort((a, b) => Number(b.id - a.id)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function transact(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const walletClient = () => {
    const p = provider();
    if (!p || !wallet) throw new Error("Connect your wallet first.");
    return createWalletClient({ chain, transport: custom(p), account: wallet as Address });
  };
  async function send(
    functionName: "stake" | "withdraw" | "claimReward",
    args: readonly unknown[],
  ) {
    await ensureChain();
    const hash = await walletClient().writeContract({
      address: STAKING,
      abi: ABI,
      functionName,
      args,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const selectedAssets = useMemo(() => bundle.assets, [bundle]);
  return (
    <div className="stock-staking-page">
      <header className="stock-staking-heading">
        <div>
          <p className="eyebrow">CRTN · STOCK REWARDS</p>
          <h1>Stake Curtain</h1>
          <p>Lock CRTN and earn stock-token rewards from your selected bundle.</p>
        </div>
        <button className="text-button" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>
      {error && (
        <div className="stock-staking-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="stock-staking-notice" role="status">
          {notice}
        </div>
      )}
      {configured === false && (
        <div className="stock-staking-alert">
          Staking service is not currently available. Your wallet transactions remain unaffected.
        </div>
      )}
      <div className="stock-staking-grid">
        <section className="panel form-panel stock-staking-card">
          <p className="eyebrow">CREATE A POSITION</p>
          <h2>Choose your lock</h2>
          <label className="field-label" htmlFor="stock-stake-amount">
            Amount · CRTN{" "}
            {balance !== undefined ? `· Balance ${formatUnits(balance, decimals)}` : ""}
          </label>
          <input
            id="stock-stake-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="field-label">Reward bundle</p>
          <div className="stock-bundle-options">
            {BUNDLES.map((item) => (
              <button
                key={item.id.toString()}
                className="panel"
                aria-pressed={bundleId === item.id}
                onClick={() => setBundleId(item.id)}
              >
                <strong>{item.name}</strong>
                <small>{item.assets.map((asset) => asset.symbol).join(" · ")}</small>
              </button>
            ))}
          </div>
          <p className="field-label">Lock period</p>
          <div className="stock-lock-options">
            {[
              { days: 30, multiplier: "1×" },
              { days: 90, multiplier: "1.5×" },
              { days: 180, multiplier: "2×" },
            ].map((item, i) => (
              <button
                key={item.days}
                className="panel"
                aria-pressed={tier === i}
                onClick={() => setTier(i)}
              >
                <strong>{item.days} days</strong>
                <small>{item.multiplier} reward weight</small>
              </button>
            ))}
          </div>
          <button
            className="button gold"
            disabled={busy || !wallet || configured !== true || !amount}
            onClick={() =>
              void transact(async () => {
                const value = parseUnits(amount, decimals);
                if (value <= 0n || balance === undefined || value > balance)
                  throw new Error("Enter an amount within your available CRTN balance.");
                await ensureChain();
                const client = walletClient();
                const allowance = await publicClient.readContract({
                  address: CRTN,
                  abi: erc20Abi,
                  functionName: "allowance",
                  args: [wallet as Address, STAKING],
                });
                if (allowance < value) {
                  const approve = await client.writeContract({
                    address: CRTN,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [STAKING, value],
                  });
                  await publicClient.waitForTransactionReceipt({ hash: approve });
                }
                await send("stake", [value, tier, bundleId]);
                setAmount("");
              }, "CRTN staked. Your lock starts now; rewards become claimable when it unlocks.")
            }
          >
            {busy ? "Processing…" : wallet ? "Stake CRTN" : "Connect wallet to stake"}
          </button>
          {!wallet && (
            <button className="text-button" onClick={connect}>
              Connect wallet
            </button>
          )}
          <p className="field-help">
            Rewards accrue over time and are claimable after the selected lock ends. Stake positions
            and reward streams are separate: reward inventory must be scheduled to begin emissions.
          </p>
        </section>
        <section className="panel stock-staking-card stock-overview">
          <p className="eyebrow">ON-CHAIN OVERVIEW</p>
          <h2>
            <Coins size={20} /> Stock bundles
          </h2>
          <div className="stock-total">
            <span>Total CRTN staked</span>
            <strong>{formatUnits(totalStaked, decimals)}</strong>
          </div>
          {BUNDLES.map((item) => (
            <article className="stock-bundle-row" key={item.id.toString()}>
              <strong>{item.name}</strong>
              <span>{item.assets.map((asset) => asset.symbol).join(" · ")}</span>
            </article>
          ))}
          <p className="field-help">
            Bundle mixes are fixed for existing bundles. New bundles may be added later.
          </p>
        </section>
      </div>
      <section className="stock-positions">
        <div className="panel-heading">
          <h2>Your positions</h2>
          <span>{positions.length} total</span>
        </div>
        {!wallet ? (
          <div className="panel empty-compact">Connect your wallet to view positions.</div>
        ) : positions.length === 0 ? (
          <div className="panel empty-compact">No staking positions found for this wallet.</div>
        ) : (
          positions.map((position) => {
            const selected = BUNDLES.find((item) => item.id === position.bundleId)!;
            const unlocked = BigInt(Math.floor(Date.now() / 1000)) >= position.unlockAt;
            return (
              <article className="panel stock-position" key={position.id.toString()}>
                <div className="stock-position-head">
                  <div>
                    <strong>Position #{position.id.toString()}</strong>
                    <span>
                      {selected.name} · {formatUnits(position.amount, decimals)} CRTN
                    </span>
                  </div>
                  <span>
                    {position.closed ? "Principal withdrawn" : timeLeft(position.unlockAt)}
                  </span>
                </div>
                <div className="stock-reward-list">
                  {selected.assets.map((asset) => (
                    <div key={asset.symbol}>
                      <span>{asset.symbol}</span>
                      <strong>{formatUnits(position.rewards[asset.symbol] ?? 0n, 18)}</strong>
                      <button
                        className="text-button"
                        disabled={
                          busy ||
                          !unlocked ||
                          position.closed ||
                          (position.rewards[asset.symbol] ?? 0n) === 0n
                        }
                        onClick={() =>
                          void transact(async () => {
                            const response = await fetch("/api/curtain/staking/claim-signature", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                positionId: position.id.toString(),
                                account: wallet,
                                token: asset.address,
                              }),
                            });
                            const payload = (await response.json()) as {
                              amount?: string;
                              deadline?: number;
                              signature?: `0x${string}`;
                              error?: string;
                            };
                            if (
                              !response.ok ||
                              !payload.amount ||
                              !payload.deadline ||
                              !payload.signature
                            )
                              throw new Error(payload.error || "Could not prepare reward claim.");
                            await send("claimReward", [
                              position.id,
                              tokenAddress(asset.address),
                              BigInt(payload.amount),
                              BigInt(payload.deadline),
                              payload.signature,
                            ]);
                          }, `${asset.symbol} rewards claimed.`)
                        }
                      >
                        Claim
                      </button>
                    </div>
                  ))}
                </div>
                {!position.closed && (
                  <button
                    className="button secondary"
                    disabled={busy || !unlocked}
                    onClick={() =>
                      void transact(
                        () => send("withdraw", [position.id]),
                        "Your CRTN principal has been returned.",
                      )
                    }
                  >
                    {unlocked ? "Withdraw CRTN" : "Locked until maturity"}
                  </button>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
