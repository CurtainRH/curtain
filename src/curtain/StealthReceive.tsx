/**
 * Receive privately: #3 set up and publish stealth keys, #2 the private inbox.
 *
 * Keys come from a wallet signature (re-signing restores them) and live only in this page's
 * memory: nothing is stored or sent anywhere. The inbox scans public announcements in the
 * browser, so no server learns which payments are yours.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Copy, KeyRound, RefreshCw } from "lucide-react";
import {
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeMetaAddress,
  matchAnnouncement,
  metaAddressBytes,
  parseMetaAddress,
  STEALTH_ANNOUNCEMENT_EVENT,
  STEALTH_KEYS_MESSAGE,
  STEALTH_REGISTRY_ABI,
  stealthKeysFromSignature,
  VAULT_ABI,
  type StealthKeys,
} from "@curtain/sdk";
import {
  address,
  chain,
  decimals,
  errorMessage,
  fallbackVault,
  logsInChunks,
  provider,
  publicClient,
  stealthAnnouncer,
  stealthRegistry,
  stealthScanFromBlock,
} from "./integration";
import type { TokenData } from "./useCurtain";

interface Holding {
  token: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
}

interface InboxItem {
  stealthAddress: Address;
  key: Hex;
  eth: bigint;
  holdings: Holding[];
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function StealthReceive({
  wallet,
  tokens,
  showKeys,
  showInbox,
  busy,
  run,
  setMessage,
}: {
  wallet: string;
  tokens: TokenData[];
  showKeys: boolean;
  showInbox: boolean;
  busy: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [keys, setKeys] = useState<StealthKeys>();
  /** The wallet's registry entry: undefined = not loaded, "0x" = none. */
  const [published, setPublished] = useState<Hex>();
  const [items, setItems] = useState<InboxItem[]>();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [destination, setDestination] = useState("");
  const [copied, setCopied] = useState(false);

  // Keys belong to one wallet: forget them (and the inbox) when the wallet changes.
  useEffect(() => {
    setKeys(undefined);
    setItems(undefined);
    setPublished(undefined);
    setScanError("");
    if (!stealthRegistry || !address(wallet)) return;
    let alive = true;
    publicClient
      .readContract({
        address: stealthRegistry,
        abi: STEALTH_REGISTRY_ABI,
        functionName: "stealthMetaAddressOf",
        args: [wallet as Address, 1n],
      })
      .then((raw) => alive && setPublished(raw))
      .catch(() => alive && setPublished(undefined));
    return () => {
      alive = false;
    };
  }, [wallet]);

  const ourBytes = keys ? metaAddressBytes(keys.meta).toLowerCase() : undefined;
  const publishedHere = !!ourBytes && published?.toLowerCase() === ourBytes;
  const publishedOther = !!published && published !== "0x" && !publishedHere;
  let publishedOtherValid = false;
  if (publishedOther) {
    try {
      parseMetaAddress(published);
      publishedOtherValid = true;
    } catch {
      publishedOtherValid = false;
    }
  }

  function browserWallet() {
    const p = provider();
    if (!p) throw new Error("Connect a browser wallet first.");
    return createWalletClient({ chain, transport: custom(p), account: wallet as Address });
  }

  async function unlock() {
    await run("Unlock stealth keys", async () => {
      const w = browserWallet();
      const first = await w.signMessage({
        account: wallet as Address,
        message: STEALTH_KEYS_MESSAGE,
      });
      const second = await w.signMessage({
        account: wallet as Address,
        message: STEALTH_KEYS_MESSAGE,
      });
      // Keys are derived from the signature. A wallet that signs differently each time (some
      // smart-contract wallets) would lose access to its payments, so refuse it up front.
      if (first.toLowerCase() !== second.toLowerCase())
        throw new Error(
          "Your wallet gave two different signatures for the same message, so it can't safely hold stealth keys. Use a standard wallet such as MetaMask or Rabby.",
        );
      setKeys(stealthKeysFromSignature(first));
      setMessage("Stealth keys unlocked for this visit. They're never stored or sent anywhere.");
    });
  }

  async function publish() {
    if (!keys || !stealthRegistry) return;
    await run("Publish stealth keys", async () => {
      const hash = await browserWallet().writeContract({
        chain,
        account: wallet as Address,
        address: stealthRegistry!,
        abi: STEALTH_REGISTRY_ABI,
        functionName: "registerKeys",
        args: [1n, metaAddressBytes(keys.meta)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The transaction didn't go through, so nothing changed. Please try again.");
      setPublished(metaAddressBytes(keys.meta));
      setMessage(
        "Stealth keys published. People can now pay you privately by entering your wallet address.",
      );
    });
  }

  async function copyMeta() {
    if (!keys) return;
    try {
      await navigator.clipboard.writeText(encodeMetaAddress(keys.meta));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Couldn't copy. Select the address and copy it manually.");
    }
  }

  async function scan(current = keys) {
    if (!current || !stealthAnnouncer || !fallbackVault) return;
    setScanning(true);
    setScanError("");
    try {
      const head = await publicClient.getBlockNumber();
      const announcements = await logsInChunks(stealthScanFromBlock, head, (fromBlock, toBlock) =>
        publicClient.getLogs({
          address: stealthAnnouncer!,
          event: STEALTH_ANNOUNCEMENT_EVENT,
          args: { schemeId: 1n },
          fromBlock,
          toBlock,
        }),
      );
      const mine = new Map<Address, Hex>();
      for (const a of announcements) {
        const { stealthAddress, ephemeralPubKey, metadata } = a.args;
        if (!stealthAddress || !ephemeralPubKey || !metadata) continue;
        const key = matchAnnouncement(current, { stealthAddress, ephemeralPubKey, metadata });
        if (key) mine.set(getAddress(stealthAddress), key);
      }
      const addresses = [...mine.keys()];
      // Which tokens Curtain paid to each address (PaidOut is indexed by recipient).
      const paid = addresses.length
        ? await logsInChunks(stealthScanFromBlock, head, (fromBlock, toBlock) =>
            publicClient.getContractEvents({
              address: fallbackVault!,
              abi: VAULT_ABI,
              eventName: "PaidOut",
              args: { recipient: addresses },
              fromBlock,
              toBlock,
            }),
          )
        : [];
      const tokensOf = new Map<Address, Set<Address>>();
      for (const p of paid) {
        if (!p.args.recipient || !p.args.token) continue;
        const r = getAddress(p.args.recipient);
        tokensOf.set(r, (tokensOf.get(r) ?? new Set()).add(getAddress(p.args.token)));
      }
      const next: InboxItem[] = [];
      for (const stealthAddress of addresses) {
        const holdings: Holding[] = [];
        for (const token of tokensOf.get(stealthAddress) ?? []) {
          const amount = await publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [stealthAddress],
          });
          const known = tokens.find((t) => t.address.toLowerCase() === token.toLowerCase());
          holdings.push({
            token,
            symbol: known?.symbol ?? short(token),
            decimals: known?.decimals ?? (await decimals(token)),
            amount,
          });
        }
        const eth = await publicClient.getBalance({ address: stealthAddress });
        next.push({ stealthAddress, key: mine.get(stealthAddress)!, eth, holdings });
      }
      setItems(next);
    } catch (e) {
      setScanError(errorMessage(e));
    } finally {
      setScanning(false);
    }
  }

  // Scan as soon as the keys are unlocked.
  useEffect(() => {
    if (keys && showInbox) void scan(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, showInbox]);

  async function withdraw(item: InboxItem) {
    const to = destination.trim();
    if (!isAddress(to) || !address(to) || getAddress(to) === item.stealthAddress) {
      setMessage("Enter the address to withdraw to.");
      return;
    }
    await run("Withdraw", async () => {
      const account = privateKeyToAccount(item.key);
      if (account.address !== item.stealthAddress)
        throw new Error("Stealth key mismatch. Unlock your keys again.");
      const stealthWallet = createWalletClient({ account, chain, transport: http() });
      let sent = 0;
      for (const h of item.holdings) {
        const amount = await publicClient.readContract({
          address: h.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [item.stealthAddress],
        });
        if (amount === 0n) continue;
        // Check gas before sending, so the error names the stealth address, not the wallet.
        const [gas, fees, eth] = await Promise.all([
          publicClient.estimateContractGas({
            account,
            address: h.token,
            abi: erc20Abi,
            functionName: "transfer",
            args: [getAddress(to), amount],
          }),
          publicClient.estimateFeesPerGas(),
          publicClient.getBalance({ address: item.stealthAddress }),
        ]);
        if (gas * (fees.maxFeePerGas ?? 0n) > eth)
          throw new Error(
            "This stealth address doesn't have enough ETH for the network fee. Send it a little ETH from a wallet that isn't linked to you, then try again.",
          );
        const hash = await stealthWallet.writeContract({
          chain,
          account,
          address: h.token,
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(to), amount],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error(
            "The transaction didn't go through, so nothing changed. Please try again.",
          );
        sent++;
      }
      setMessage(sent ? `Withdrawn to ${short(to)}.` : "Nothing left to withdraw here.");
      await scan();
    });
  }

  const linksToWallet =
    isAddress(destination.trim()) && destination.trim().toLowerCase() === wallet.toLowerCase();

  if (!address(wallet))
    return (
      <section className="panel">
        <h2>Receive privately</h2>
        <p className="field-help">Connect your wallet to set up your stealth address.</p>
      </section>
    );

  return (
    <>
      <section className="panel form-panel">
        <div className="panel-heading">
          <h2>Receive privately</h2>
          <KeyRound size={18} />
        </div>
        {!keys ? (
          <>
            <p>
              Your stealth keys let people pay you at brand-new addresses that only you can find.
              They come from a signature, so you can restore them on any device by signing again.
            </p>
            <button className="button gold" disabled={!!busy} onClick={() => void unlock()}>
              Unlock stealth keys
            </button>
            <span className="field-help">
              Your wallet asks you to sign twice. It's free, nothing goes on-chain, and the second
              signature checks that your wallet always produces the same keys.
            </span>
          </>
        ) : !showKeys ? (
          <p className="field-help">Stealth keys unlocked for this visit.</p>
        ) : (
          <>
            <p className="field-label">Your stealth meta-address</p>
            <code className="v2-meta-address">{encodeMetaAddress(keys.meta)}</code>
            <button className="text-button" onClick={() => void copyMeta()}>
              <Copy size={14} /> {copied ? "Copied" : "Copy"}
            </button>
            <span className="field-help">
              Share this with anyone who wants to pay you privately. It isn't an address you can
              send to directly; Curtain turns it into a new address for every payment.
            </span>
            {publishedHere ? (
              <span className="field-help">
                Published: people can also just enter your wallet address ({short(wallet)}) as the
                stealth recipient.
              </span>
            ) : (
              <>
                {publishedOther && (
                  <p role="alert" className="form-error">
                    {publishedOtherValid
                      ? "Your wallet already has different stealth keys published, maybe from another app. Publishing replaces them; payments sent to the old keys stay recoverable only with the app that made them."
                      : "Your wallet has an invalid stealth entry published. Publishing will replace it."}
                  </p>
                )}
                <button className="button" disabled={!!busy} onClick={() => void publish()}>
                  Publish to my wallet address
                </button>
                <span className="field-help">
                  Optional, one transaction. Lets senders type your wallet address instead of the
                  long meta-address. A fresh stealth address reduces direct wallet-to-recipient
                  linkability either way.
                </span>
              </>
            )}
          </>
        )}
      </section>

      {showInbox && keys && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Private inbox</h2>
            <button
              className="text-button"
              disabled={scanning || !!busy}
              onClick={() => void scan()}
            >
              <RefreshCw size={14} /> {scanning ? "Scanning…" : "Scan"}
            </button>
          </div>
          <p className="field-help">
            Found by scanning public announcements in your browser. No server learns which payments
            are yours.
          </p>
          {scanError && (
            <p role="alert" className="form-error">
              {scanError}
            </p>
          )}
          {items && items.length === 0 && !scanning && (
            <p className="empty-compact">No stealth payments yet.</p>
          )}
          {!!items?.length && (
            <>
              <label className="field-label" htmlFor="stealth-destination">
                Withdraw to
              </label>
              <input
                id="stealth-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="0x… (a fresh address keeps this private)"
                spellCheck={false}
                autoComplete="off"
              />
              {linksToWallet && (
                <p role="alert" className="form-error">
                  Withdrawing to your connected wallet links these payments to it on-chain. Use a
                  fresh address to keep them private.
                </p>
              )}
              {items.map((item) => {
                const has = item.holdings.some((h) => h.amount > 0n);
                return (
                  <div key={item.stealthAddress} className="v2-inbox-row">
                    <a
                      href={`${chain.blockExplorers.default.url}/address/${item.stealthAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underlined-link"
                    >
                      {short(item.stealthAddress)} <ArrowUpRight size={13} />
                    </a>
                    <span>
                      {item.holdings.length
                        ? item.holdings
                            .map((h) => `${formatUnits(h.amount, h.decimals)} ${h.symbol}`)
                            .join(" · ")
                        : "—"}
                    </span>
                    <span className="field-help">Gas: {formatUnits(item.eth, 18)} ETH</span>
                    <button
                      className="button gold"
                      disabled={!has || !!busy}
                      onClick={() => void withdraw(item)}
                    >
                      {has ? "Withdraw" : "Empty"}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}
    </>
  );
}
