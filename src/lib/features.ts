/**
 * Runtime feature flags. Each post-launch feature ships dark and turns on when its env var is
 * exactly "true" on the server (Render: set the variable, then restart; no rebuild). Anything
 * else, including a missing or misspelled variable, means off.
 *
 * Flags are read on the server and served at /api/features, never baked into the bundle, so
 * flipping one only needs a restart.
 */

/** Flag name in the browser -> env var on the server. */
export const FEATURE_ENV = {
  stealthPayouts: "FEATURE_STEALTH_PAYOUTS", // #1 send to a stealth address
  stealthKeys: "FEATURE_STEALTH_KEYS", // #3 set up and publish your stealth keys
  stealthInbox: "FEATURE_STEALTH_INBOX", // #2 find and withdraw stealth payments
  splitPayouts: "FEATURE_SPLIT_PAYOUTS", // #4 one swap paid to 2-5 recipients
  splitTiming: "FEATURE_SPLIT_TIMING", // #5 one swap delivered in 2-5 pieces at random times
} as const;

export type FeatureName = keyof typeof FEATURE_ENV;
export type Features = Record<FeatureName, boolean>;

function readEnv(key: string, env?: unknown): string | undefined {
  if (env && typeof env === "object") {
    const v = (env as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

export function readFeatures(env?: unknown): Features {
  const out = {} as Features;
  for (const [name, key] of Object.entries(FEATURE_ENV) as [FeatureName, string][]) {
    out[name] = readEnv(key, env)?.trim().toLowerCase() === "true";
  }
  return out;
}

export function handleFeatures(request: Request, env?: unknown): Response | null {
  if (new URL(request.url).pathname !== "/api/features") return null;
  return new Response(JSON.stringify(readFeatures(env)), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
