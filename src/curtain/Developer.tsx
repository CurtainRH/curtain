import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWalletClient } from "wagmi";
import { BookOpen, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import "./developer.css";

interface DeveloperKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function DeveloperDialog({
  titleId,
  children,
  close,
}: {
  titleId: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className="developer-dialog" ref={ref} aria-labelledby={titleId} onCancel={close}>
      {children}
    </dialog>
  );
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/curtain/developer/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Developer service is unavailable. Please try again.");
  return data;
}

export default function Developer({ wallet }: { wallet: string }) {
  const { data: signer } = useWalletClient();
  const [keys, setKeys] = useState<DeveloperKey[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revoke, setRevoke] = useState<DeveloperKey>();
  const [copied, setCopied] = useState(false);

  async function authorized<T>(
    action: "list" | "create" | "revoke",
    fields: Record<string, string> = {},
  ) {
    if (!wallet || !signer || signer.account.address.toLowerCase() !== wallet.toLowerCase())
      throw new Error("Connect your wallet to manage API keys.");
    const challenge = await api<{ challengeId: string; message: string }>("challenge", {
      wallet,
      action,
      ...fields,
    });
    const signature = await signer.signMessage({ message: challenge.message });
    return api<T>(`keys/${action}`, { challengeId: challenge.challengeId, signature });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message.split("\n")[0]! : "Unable to complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel developer-panel">
      <div className="panel-heading">
        <h2>Build with Curtain</h2>
      </div>
      <p>
        Bring private swaps into your application. Get quotes, prepare wallet transactions, and
        track delivery with your own API key.
      </p>
      <a className="button" href="https://docs.curtainrh.com" target="_blank" rel="noreferrer">
        <BookOpen size={16} /> Read the documentation
      </a>
      <div className="developer-facts">
        <div>
          <span>Privacy route</span>
          <strong>V2 flexible · V3 fixed denominations</strong>
        </div>
        <div>
          <span>Rate limit</span>
          <strong>60 requests / minute / key</strong>
        </div>
        <div>
          <span>API base URL</span>
          <code>https://operator.curtainrh.com/v1</code>
        </div>
      </div>
      <p>
        Keep keys on your server. Your users sign and fund their swaps in their own wallets. API
        access does not give permission to move funds.
      </p>
      {!unlocked ? (
        <button
          className="button gold"
          disabled={!wallet || !signer || busy}
          onClick={() =>
            void run(async () => {
              const data = await authorized<{ keys: DeveloperKey[] }>("list");
              setKeys(data.keys);
              setUnlocked(true);
            })
          }
        >
          <KeyRound size={16} /> {busy ? "Waiting for wallet…" : "Unlock developer access"}
        </button>
      ) : (
        <>
          <form
            className="developer-create"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await authorized<{ key: DeveloperKey; apiKey: string }>("create", {
                  name: name.trim(),
                });
                setKeys((rows) => [data.key, ...rows]);
                setSecret(data.apiKey);
                setCopied(false);
                setName("");
              });
            }}
          >
            <label htmlFor="developer-key-name">
              Key name
              <input
                id="developer-key-name"
                required
                maxLength={60}
                placeholder="My swap integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className="button gold" disabled={busy || !name.trim()}>
              <Plus size={16} /> {busy ? "Waiting for wallet…" : "Create API key"}
            </button>
          </form>
          <p className="developer-muted">
            Each management action asks for a wallet signature. No gas is required. Up to 10 active
            keys per wallet. EOA wallets supported.
          </p>
          <div className="developer-keys">
            {keys.length === 0 && <p>No API keys yet. Create one to start building.</p>}
            {keys.map((key) => (
              <article className="developer-key" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <code>{key.prefix}…</code>
                  <small>
                    Created {new Date(key.createdAt).toLocaleDateString()} ·{" "}
                    {key.revokedAt
                      ? "Revoked"
                      : key.lastUsedAt
                        ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : "Not used yet"}
                  </small>
                </div>
                {!key.revokedAt && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setRevoke(key)}
                    aria-label={`Revoke ${key.name}`}
                  >
                    <Trash2 size={15} /> Revoke
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {secret && (
        <DeveloperDialog titleId="developer-secret-title" close={() => setSecret("")}>
          <h2 id="developer-secret-title">Your API key is ready</h2>
          <p>
            Copy it now. Curtain stores only a hash, so this key cannot be shown again after you
            close this window.
          </p>
          <input
            aria-label="New API key"
            readOnly
            value={secret}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(secret)
                .then(() => setCopied(true))
                .catch(() => setMessage("Select and copy the key manually."));
            }}
          >
            <Copy size={15} /> {copied ? "Copied" : "Copy key"}
          </button>
          <button className="button gold" onClick={() => setSecret("")}>
            I’ve saved my key
          </button>
        </DeveloperDialog>
      )}
      {revoke && (
        <DeveloperDialog titleId="developer-revoke-title" close={() => setRevoke(undefined)}>
          <h2 id="developer-revoke-title">Revoke {revoke.name}?</h2>
          <p>
            New requests using this key will stop working. Swaps already deposited can still settle,
            and their on-chain refund rights remain available. A new key cannot access this key’s
            intent history.
          </p>
          <button className="button" disabled={busy} onClick={() => setRevoke(undefined)}>
            Cancel
          </button>
          <button
            className="button gold"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await authorized("revoke", { keyId: revoke.id });
                setKeys((rows) =>
                  rows.map((row) =>
                    row.id === revoke.id ? { ...row, revokedAt: new Date().toISOString() } : row,
                  ),
                );
                setRevoke(undefined);
              })
            }
          >
            {busy ? "Waiting for wallet…" : "Sign to revoke"}
          </button>
        </DeveloperDialog>
      )}
      {message && (
        <DeveloperDialog titleId="developer-message-title" close={() => setMessage("")}>
          <h2 id="developer-message-title">Developer access</h2>
          <p>{message}</p>
          <button className="button gold" onClick={() => setMessage("")}>
            Close
          </button>
        </DeveloperDialog>
      )}
    </section>
  );
}
