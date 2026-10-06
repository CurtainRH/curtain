import { ShieldCheck } from "lucide-react";
import { privacyScore } from "./integration";

/** #7: a 1-5 privacy meter for the swap being composed, with what would raise it. */
export default function PrivacyScore(props: Parameters<typeof privacyScore>[0]) {
  const { score, factors } = privacyScore(props);
  const level = score >= 4 ? "Strong" : score >= 2.5 ? "Fair" : "Low";
  const tips = factors.filter((f) => f.tip);
  return (
    <section className="v2-privacy-score" aria-label={`Privacy score ${score} out of 5`}>
      <div className="v2-privacy-score-head">
        <ShieldCheck size={16} />
        <strong>
          Privacy score {score}/5 · {level}
        </strong>
      </div>
      <div className="v2-privacy-meter" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={score >= i ? "full" : score >= i - 0.5 ? "half" : ""} />
        ))}
      </div>
      <ul>
        {factors.map((f) => (
          <li key={f.label} className={f.points >= f.max ? "done" : ""}>
            {f.label}
          </li>
        ))}
      </ul>
      {tips.length > 0 && (
        <p className="field-help">To raise it: {tips.map((f) => f.tip).join(" ")}</p>
      )}
      <p className="field-help">
        An estimate of how hard it is to match this swap's deposit to its payout, not a guarantee.
      </p>
    </section>
  );
}
