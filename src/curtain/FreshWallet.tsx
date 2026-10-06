/**
 * #9: create a brand-new recipient wallet in the browser and download it as a
 * password-encrypted keystore file (imports into MetaMask, Rabby, …). Nothing is sent anywhere,
 * and only the encrypted file is kept in memory, for "download again".
 */
import { useState } from "react";
import { Download, KeyRound } from "lucide-react";
import type { Address } from "viem";
import { downloadFile } from "./domain";
import { errorMessage } from "./integration";
import { createFreshWallet, type KeystoreV3 } from "./keystore";

export default function FreshWallet({
  onUse,
  onSaved,
}: {
  /** The new wallet becomes the recipient. */
  onUse: (address: Address) => void;
  /** Whether the user confirmed they saved the file and password for this wallet. */
  onSaved: (address: Address, saved: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ address: Address; keystore: KeystoreV3 }>();
  const [saved, setSaved] = useState(false);

  const problem =
    password.length < 10
      ? "Use a password of at least 10 characters."
      : password !== confirm
        ? "The passwords don't match."
        : !understood
          ? "Tick the box to confirm you understand."
          : "";

  function download(w: { address: Address; keystore: KeystoreV3 }) {
    downloadFile(`curtain-fresh-wallet-${w.address.slice(2, 8).toLowerCase()}.json`, w.keystore);
  }

  async function create() {
    if (problem || creating) return;
    setCreating(true);
    setError("");
    try {
      const w = await createFreshWallet(password);
      download(w);
      setMade(w);
      setSaved(false);
      onSaved(w.address, false);
      onUse(w.address);
      setPassword("");
      setConfirm("");
      setUnderstood(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  if (!open && !made)
    return (
      <button className="text-button" onClick={() => setOpen(true)}>
        <KeyRound size={14} /> Create a fresh wallet
      </button>
    );

  if (made)
    return (
      <div className="v2-fresh-wallet">
        <p className="field-help">
          Fresh wallet {made.address.slice(0, 6)}…{made.address.slice(-4)} created and downloaded,
          and set as the recipient. To use it, import the file in MetaMask or Rabby (Add account →
          Import account → JSON file) with your password.
        </p>
        <div className="v2-fresh-actions">
          <button className="text-button" onClick={() => download(made)}>
            <Download size={14} /> Download again
          </button>
          <button className="text-button" onClick={() => onUse(made.address)}>
            Use it as recipient
          </button>
          <button
            className="text-button"
            onClick={() => {
              setMade(undefined);
              setOpen(true);
            }}
          >
            Create another
          </button>
        </div>
        <label className="v2-check">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => {
              setSaved(e.target.checked);
              onSaved(made.address, e.target.checked);
            }}
          />
          I've saved the wallet file and I remember its password.
        </label>
      </div>
    );

  return (
    <div className="v2-fresh-wallet">
      <p className="field-help">
        Creates a brand-new wallet in your browser, with no link to any of your wallets, and
        downloads it as a file locked with your password. Curtain never sees the key.
      </p>
      <label className="field-label" htmlFor="fresh-password">
        Password for the wallet file
      </label>
      <input
        id="fresh-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <label className="field-label" htmlFor="fresh-confirm">
        Repeat password
      </label>
      <input
        id="fresh-confirm"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <label className="v2-check">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        I understand the file and password are the only way into this wallet. Curtain can't recover
        them.
      </label>
      {(password || confirm) && problem && <p className="field-help">{problem}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="v2-fresh-actions">
        <button
          className="button gold"
          disabled={!!problem || creating}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : "Create & download"}
        </button>
        <button className="text-button" disabled={creating} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
