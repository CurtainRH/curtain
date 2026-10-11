import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { formatUnits, isAddress } from "viem";
import { RouteLink, useNav } from "./App";

type Summary = { staked: string; rewardUsd: string; positions: number; nextUnlock: number | null };

function compact(value: bigint, decimals: number, maxFraction = 4) {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
}

function unlockLabel(timestamp: number | null) {
  if (timestamp === null) return "No active lock";
  const seconds = timestamp - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "Unlocked";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `In ${days}d ${hours}h` : `In ${hours}h`;
}

export default function PortfolioSnapshot({ openSwaps }: { openSwaps: number }) {
  const { wallet } = useNav();
  const [summary, setSummary] = useState<Summary>();
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!wallet || !isAddress(wallet)) {
      setSummary(undefined);
      setUnavailable(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/curtain/staking/summary?account=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const result = await response.json() as Summary & { error?: string };
      if (!response.ok || !/^\d+$/.test(result.staked) || !/^\d+$/.test(result.rewardUsd) || !Number.isInteger(result.positions)) throw new Error(result.error || "Staking summary unavailable");
      setSummary(result);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!wallet) return;
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [wallet, refresh]);

  return <section className="panel portfolio-snapshot">
    <div className="portfolio-snapshot-heading">
      <div><p className="eyebrow">YOUR CURTAIN AT A GLANCE</p><h2>Portfolio snapshot</h2></div>
      <button className="text-button" type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh portfolio snapshot" title="Refresh">
        <RefreshCw size={15} className={loading ? "portfolio-refreshing" : ""} /> Refresh
      </button>
    </div>
    {!wallet ? <p className="portfolio-snapshot-empty">Connect your wallet to see your staking and swap activity.</p> : unavailable ? <p className="portfolio-snapshot-empty">Staking details are temporarily unavailable. Your positions are unchanged.</p> : <>
      <div className="portfolio-metrics">
        <div><span>CRTN staked</span><strong>{summary ? `${compact(BigInt(summary.staked), 18)} CRTN` : "Loading…"}</strong></div>
        <div><span>Accrued reward value</span><strong>{summary ? `${compact(BigInt(summary.rewardUsd), 6)} USDG` : "Loading…"}</strong></div>
        <div><span>Active positions</span><strong>{summary ? summary.positions : "Loading…"}</strong></div>
        <div><span>Open swaps</span><strong>{openSwaps}</strong></div>
      </div>
      <div className="portfolio-snapshot-footer">
        <span>Next staking unlock <strong>{summary ? unlockLabel(summary.nextUnlock) : "Loading…"}</strong></span>
        <span className="portfolio-snapshot-links">
          <RouteLink to="/app/staking">Staking <ArrowUpRight size={14} /></RouteLink>
          <RouteLink to="/app/activity">Activity <ArrowUpRight size={14} /></RouteLink>
          <RouteLink to="/app/recovery">Recovery <ArrowUpRight size={14} /></RouteLink>
        </span>
      </div>
      <p className="portfolio-snapshot-note">Rewards are shown in USDG value; stock-token amounts are determined when claimed.</p>
    </>}
  </section>;
}
