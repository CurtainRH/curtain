export const STOCK_REWARD_BASE_APR_BPS = 400n;
export const STOCK_REWARD_YEAR_SECONDS = 365n * 24n * 60n * 60n;
const BPS = 10_000n;
const TIERS = [
  { seconds: 30n * 24n * 60n * 60n, multiplierBps: 10_000n },
  { seconds: 90n * 24n * 60n * 60n, multiplierBps: 15_000n },
  { seconds: 180n * 24n * 60n * 60n, multiplierBps: 20_000n },
] as const;

/** Mirrors CurtainStockStaking.earnedUsd() for an estimate at the selected lock's maturity. */
export function estimateStockRewardUsd(principalUsd: bigint, tierId: number): bigint {
  const tier = TIERS[tierId];
  if (principalUsd < 0n || !tier) throw new RangeError("Invalid principal value or staking tier");
  return principalUsd * STOCK_REWARD_BASE_APR_BPS * tier.multiplierBps * tier.seconds /
    (BPS * BPS * STOCK_REWARD_YEAR_SECONDS);
}

/** Mirrors claim allocation: floor each weighted share and assign rounding remainder to the last asset. */
export function splitBundleRewardUsd(rewardUsd: bigint, weightsBps: readonly number[]): bigint[] {
  if (rewardUsd < 0n || weightsBps.length === 0 || weightsBps.some(weight => !Number.isInteger(weight) || weight <= 0) ||
      weightsBps.reduce((sum, weight) => sum + weight, 0) !== Number(BPS)) {
    throw new RangeError("Bundle weights must be positive integers totaling 10,000 bps");
  }
  let allocated = 0n;
  return weightsBps.map((weight, index) => {
    const share = index === weightsBps.length - 1
      ? rewardUsd - allocated
      : rewardUsd * BigInt(weight) / BPS;
    allocated += share;
    return share;
  });
}
