import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, erc20Abi, formatUnits, isAddress, parseAbi, parseAbiItem, parseUnits, type Address } from "viem";
import { Coins, RefreshCw } from "lucide-react";
import { useNav } from "./App";
import { chain, ensureChain, errorMessage, provider, publicClient } from "./integration";

const CRTN = "0x66A844fcbf4705Dbde3c97394d5a4C9822E8F35b" as Address;
const ABI = parseAbi([
  "function stake(uint256,uint8,uint256,uint256,uint256,bytes) returns (uint256)",
  "function positions(uint256) view returns (address owner,uint128 amount,uint128 principalUsd,uint128 claimedUsd,uint64 stakedAt,uint64 unlockAt,uint32 bundleId,uint8 tierId,bool principalWithdrawn)",
  "function earnedUsd(uint256) view returns (uint256)",
  "function withdraw(uint256)",
  "function claimStockRewards(uint256,uint256,address[],uint256[],uint256,bytes)",
  "function totalStaked() view returns (uint256)",
]);
type Bundle = { id: number; name: string; assets: { address: Address; symbol: string; weightBps: number }[] };
type Position = { id: bigint; amount: bigint; principalUsd: bigint; rewardUsd: bigint; unlockAt: bigint; bundleId: bigint; withdrawn: boolean };
type StakeQuote = { account: string; amount: string; tierId: number; bundleId: number; principalUsd: string; priceSource: "uniswap-v3-v4" | "codex.io"; deadline: number; signature: `0x${string}` };
const tierOptions = [{ days: 30, multiplier: "1×" }, { days: 90, multiplier: "1.5×" }, { days: 180, multiplier: "2×" }];
const timeLeft = (unlockAt: bigint) => {
  const seconds = Number(unlockAt) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "Unlocked";
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h remaining`;
};

export default function StockStaking() {
  const { wallet, connect } = useNav();
  const [staking, setStaking] = useState<Address>();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [amount, setAmount] = useState("");
  const [bundleId, setBundleId] = useState(1);
  const [tier, setTier] = useState(0);
  const [balance, setBalance] = useState<bigint>();
  const [positions, setPositions] = useState<Position[]>([]);
  const [totalStaked, setTotalStaked] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [stakeQuote, setStakeQuote] = useState<StakeQuote>();

  const walletClient = () => {
    const p = provider();
    if (!p || !wallet) throw new Error("Connect your wallet first.");
    return createWalletClient({ chain, transport: custom(p), account: wallet as Address });
  };
  const transact = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/curtain/staking/config", { cache: "no-store" });
      const config = await response.json() as { enabled?: boolean; staking?: string; bundles?: Bundle[]; startBlock?: string; error?: string };
      if (!response.ok || !config.enabled || !config.staking || !isAddress(config.staking)) throw new Error(config.error || "Stock staking is not currently available.");
      const contract = config.staking as Address;
      setStaking(contract); setBundles(config.bundles ?? []); setConfigured(true);
      if (!wallet || !isAddress(wallet)) { setPositions([]); return; }
      const [tokenBalance, staked, logs] = await Promise.all([
        publicClient.readContract({ address: CRTN, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] }),
        publicClient.readContract({ address: contract, abi: ABI, functionName: "totalStaked" }),
        publicClient.getLogs({ address: contract, event: parseAbiItem("event Staked(uint256 indexed positionId,address indexed owner,uint256 indexed bundleId,uint256 amount,uint8 tierId,uint64 unlockAt,uint256 principalUsd)"), args: { owner: wallet as Address }, fromBlock: BigInt(config.startBlock ?? "0"), toBlock: "latest" }),
      ]);
      setBalance(tokenBalance); setTotalStaked(staked);
      const ids = [...new Set(logs.map(log => log.args.positionId).filter((id): id is bigint => id !== undefined))];
      const found = await Promise.all(ids.map(async id => {
        const p = await publicClient.readContract({ address: contract, abi: ABI, functionName: "positions", args: [id] });
        const rewardUsd = await publicClient.readContract({ address: contract, abi: ABI, functionName: "earnedUsd", args: [id] });
        return { id, amount: BigInt(p[1]), principalUsd: BigInt(p[2]), unlockAt: BigInt(p[5]), bundleId: BigInt(p[6]), withdrawn: p[8], rewardUsd };
      }));
      setPositions(found.sort((a, b) => Number(b.id - a.id)));
    } catch (e) { setConfigured(false); setError(errorMessage(e)); }
  }, [wallet]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(functionName: "stake" | "withdraw" | "claimStockRewards", args: readonly unknown[]) {
    if (!staking) throw new Error("Staking is not configured.");
    await ensureChain();
    const hash = await walletClient().writeContract({ address: staking, abi: ABI, functionName, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction did not complete. Please try again.");
  }

  const selectedBundle = bundles.find(bundle => bundle.id === bundleId);
  const quoteMatchesSelection = stakeQuote?.account.toLowerCase() === wallet?.toLowerCase() && stakeQuote?.amount === amount && stakeQuote.tierId === tier && stakeQuote.bundleId === bundleId;
  const requestStakeQuote = () => void transact(async () => {
    const value = parseUnits(amount, 18);
    if (value <= 0n || balance === undefined || value > balance) throw new Error("Enter an amount within your available CRTN balance.");
    const response = await fetch("/api/curtain/staking/stake-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: wallet, amount: value.toString(), tierId: tier, bundleId: String(bundleId) }) });
    const quote = await response.json() as { principalUsd?: string; priceSource?: StakeQuote["priceSource"]; deadline?: number; signature?: `0x${string}`; error?: string };
    if (!response.ok || !quote.principalUsd || !quote.deadline || !quote.signature || !quote.priceSource) throw new Error(quote.error || "A current CRTN/USDG quote is unavailable.");
    setStakeQuote({ account: wallet!, amount, tierId: tier, bundleId, principalUsd: quote.principalUsd, priceSource: quote.priceSource, deadline: quote.deadline, signature: quote.signature });
  }, "Stake quote ready. Review the valuation source before approving and staking.");
  const confirmStake = () => void transact(async () => {
    if (!quoteMatchesSelection || !stakeQuote || stakeQuote.deadline <= Math.floor(Date.now() / 1000)) throw new Error("This quote has expired or no longer matches your selection. Request a new quote.");
    const value = parseUnits(amount, 18);
    if (balance === undefined || value <= 0n || value > balance) throw new Error("Enter an amount within your available CRTN balance.");
    await ensureChain(); const client = walletClient();
    const allowance = await publicClient.readContract({ address: CRTN, abi: erc20Abi, functionName: "allowance", args: [wallet as Address, staking!] });
    if (allowance < value) { const hash = await client.writeContract({ address: CRTN, abi: erc20Abi, functionName: "approve", args: [staking!, value] }); await publicClient.waitForTransactionReceipt({ hash }); }
    await send("stake", [value, tier, BigInt(bundleId), BigInt(stakeQuote.principalUsd), BigInt(stakeQuote.deadline), stakeQuote.signature]);
    setAmount(""); setStakeQuote(undefined);
  }, "CRTN locked. Your stock-bundle reward accrues at the selected rate until maturity.");
  return <div className="stock-staking-page">
    <header className="stock-staking-heading"><div><p className="eyebrow">CRTN · STOCK REWARDS</p><h1>Stake Curtain</h1><p>Lock CRTN for a fixed term and receive stock-token rewards in your chosen bundle.</p></div>
      <button className="text-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Refresh</button></header>
    {error && <div className="stock-staking-alert" role="alert">{error}</div>}
    {notice && <div className="stock-staking-notice" role="status">{notice}</div>}
    {configured === false && <div className="stock-staking-alert">Staking service is not currently available. Your wallet remains unaffected.</div>}
    <div className="stock-staking-grid">
      <section className="panel form-panel stock-staking-card">
        <p className="eyebrow">CREATE A POSITION</p><h2>Choose your lock</h2>
        <label className="field-label" htmlFor="stock-stake-amount">Amount · CRTN {balance !== undefined ? `· Balance ${formatUnits(balance, 18)}` : ""}</label>
        <input id="stock-stake-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => { setAmount(e.target.value); setStakeQuote(undefined); }} />
        <p className="field-label">Stock bundle</p><div className="stock-bundle-options">{bundles.map(bundle => <button key={bundle.id} className="panel" aria-pressed={bundleId === bundle.id} onClick={() => { setBundleId(bundle.id); setStakeQuote(undefined); }}><strong>{bundle.name}</strong><small>{bundle.assets.map(asset => `${asset.symbol} ${asset.weightBps / 100}%`).join(" · ")}</small></button>)}</div>
        <p className="field-label">Lock period</p><div className="stock-lock-options">{tierOptions.map((item, i) => <button key={item.days} className="panel" aria-pressed={tier === i} onClick={() => { setTier(i); setStakeQuote(undefined); }}><strong>{item.days} days</strong><small>{item.multiplier} multiplier · {4 * Number(item.multiplier.replace("×", ""))}% APR</small></button>)}</div>
        {quoteMatchesSelection && stakeQuote && <div className="stock-staking-notice" role="status">
          <strong>Stake valuation: {formatUnits(BigInt(stakeQuote.principalUsd), 6)} USDG</strong>
          <p>Price source: {stakeQuote.priceSource === "codex.io" ? "Codex.io market data (USD price treated as USDG equivalent)" : "Uniswap V3/V4 live quote"}. Review this valuation before continuing.</p>
        </div>}
        <button className="button gold" disabled={busy || !wallet || configured !== true || !amount || !selectedBundle} onClick={quoteMatchesSelection ? confirmStake : requestStakeQuote}>
          {busy ? "Processing…" : !wallet ? "Connect wallet to stake" : quoteMatchesSelection ? "Approve & stake CRTN" : "Get stake quote"}
        </button>
        {!wallet && <button className="text-button" onClick={connect}>Connect wallet</button>}
        <p className="field-help">The base rate is 4% APR. The 30-, 90-, and 180-day locks use 1×, 1.5×, and 2× multipliers. Your CRTN is valued in USDG when you stake; rewards stop at the end of the selected lock.</p>
      </section>
      <section className="panel stock-staking-card stock-overview"><p className="eyebrow">STOCK BUNDLES</p><h2><Coins size={20} /> Choose a mix</h2><div className="stock-total"><span>Total CRTN staked</span><strong>{formatUnits(totalStaked, 18)}</strong></div>{bundles.map(bundle => <article className="stock-bundle-row" key={bundle.id}><strong>{bundle.name}</strong><span>{bundle.assets.map(asset => `${asset.symbol} ${asset.weightBps / 100}%`).join(" · ")}</span></article>)}<p className="field-help">At maturity, the USDG value of your reward is split across the bundle and paid in its stock tokens. Token quantities use current Uniswap V4 quotes.</p></section>
    </div>
    <section className="stock-positions"><div className="panel-heading"><h2>Your positions</h2><span>{positions.length} total</span></div>
      {!wallet ? <div className="panel empty-compact">Connect your wallet to view positions.</div> : positions.length === 0 ? <div className="panel empty-compact">No staking positions found for this wallet.</div> : positions.map(position => {
        const bundle = bundles.find(item => BigInt(item.id) === position.bundleId); const unlocked = BigInt(Math.floor(Date.now() / 1000)) >= position.unlockAt;
        return <article className="panel stock-position" key={String(position.id)}><div className="stock-position-head"><div><strong>Position #{String(position.id)}</strong><span>{bundle?.name ?? `Bundle ${position.bundleId}`} · {formatUnits(position.amount, 18)} CRTN</span></div><span>{position.withdrawn ? "Principal withdrawn" : timeLeft(position.unlockAt)}</span></div>
          <div className="stock-reward-list"><div><span>Accrued stock-bundle value</span><strong>{formatUnits(position.rewardUsd, 6)} USDG</strong><button className="text-button" disabled={busy || !unlocked || position.rewardUsd === 0n} onClick={() => void transact(async () => {
            const response = await fetch("/api/curtain/staking/claim-signature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ positionId: String(position.id), account: wallet }) });
            const claim = await response.json() as { rewardUsd?: string; tokens?: Address[]; amounts?: string[]; deadline?: number; signature?: `0x${string}`; error?: string };
            if (!response.ok || !claim.rewardUsd || !claim.tokens || !claim.amounts || !claim.deadline || !claim.signature) throw new Error(claim.error || "Claims are temporarily unavailable. Please try again later; your accrued rewards are unchanged.");
            await send("claimStockRewards", [position.id, BigInt(claim.rewardUsd), claim.tokens, claim.amounts.map(BigInt), BigInt(claim.deadline), claim.signature]);
          }, "Your stock-bundle rewards have been claimed." )}>Claim bundle</button></div></div>
          {!position.withdrawn && <button className="button secondary" disabled={busy || !unlocked} onClick={() => void transact(() => send("withdraw", [position.id]), "Your CRTN principal has been returned.")}>{unlocked ? "Withdraw CRTN" : "Locked until maturity"}</button>}
        </article>;
      })}
    </section>
  </div>;
}
