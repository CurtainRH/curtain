import { useEffect, useState } from "react";
import type { Features } from "../lib/features";

const OFF: Features = {
  stealthPayouts: false,
  stealthKeys: false,
  stealthInbox: false,
  splitPayouts: false,
  splitTiming: false,
  roundNudge: false,
};

let loaded: Promise<Features> | undefined;

/** Fetched once per page load; any failure leaves every feature off. */
function loadFeatures(): Promise<Features> {
  loaded ??= fetch("/api/features", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then((r): Promise<Partial<Features>> | Partial<Features> => (r.ok ? r.json() : {}))
    .then((f) => {
      const out = { ...OFF };
      for (const k of Object.keys(OFF) as (keyof Features)[]) out[k] = f[k] === true;
      return out;
    })
    .catch(() => {
      loaded = undefined; // try again on the next mount
      return { ...OFF };
    });
  return loaded;
}

export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(OFF);
  useEffect(() => {
    let alive = true;
    void loadFeatures().then((f) => alive && setFeatures(f));
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
