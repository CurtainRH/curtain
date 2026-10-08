/**
 * #13: escape tickets backed up on the operator, encrypted in this browser with keys derived
 * from a wallet signature. Signing again on any device restores them. The keys live only in
 * this page's memory; the operator stores an id that isn't the wallet address and a blob it
 * can't open.
 */
import { useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { createWalletClient, custom, type Address } from "viem";
import {
  openBackup,
  sealBackup,
  syncKeysFromSignature,
  TICKET_SYNC_MESSAGE,
  type CurtainClient,
  type SyncKeys,
} from "@curtain/sdk";
import {
  chain,
  errorMessage,
  isSavedTicket,
  provider,
  readTickets,
  trustedVault,
  type SavedTicket,
} from "./integration";

const sameTicket = (a: SavedTicket, b: SavedTicket) =>
  a.ticket.vault.toLowerCase() === b.ticket.vault.toLowerCase() &&
  a.ticket.depositId === b.ticket.depositId;

export default function TicketSync({
  wallet,
  sdk,
  tickets,
  addTicket,
  busy,
  run,
  setMessage,
}: {
  wallet: string;
  sdk: CurtainClient;
  tickets: SavedTicket[];
  addTicket: (row: SavedTicket) => void;
  busy: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [keys, setKeys] = useState<SyncKeys>();
  const [status, setStatus] = useState("");
  const lastPushed = useRef("");
  /** Everything known to be in the backup. Pushes only ever add to it, so a device whose
   * storage is empty or unavailable can never shrink the backup. */
  const backedUp = useRef<SavedTicket[]>([]);
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;

  // Keys belong to one wallet: forget them when it changes.
  useEffect(() => {
    setKeys(undefined);
    setStatus("");
    lastPushed.current = "";
    backedUp.current = [];
  }, [wallet]);

  async function push(current: SyncKeys) {
    const list = [...backedUp.current];
    for (const row of [...readTickets(wallet), ...ticketsRef.current])
      if (!list.some((t) => sameTicket(t, row))) list.push(row);
    const fingerprint = JSON.stringify(list);
    if (fingerprint === lastPushed.current) return;
    await sdk.pushBackup(current, await sealBackup(list, current.encKey));
    backedUp.current = list;
    lastPushed.current = fingerprint;
    setStatus(`Backed up ${list.length} ticket${list.length === 1 ? "" : "s"} just now.`);
  }

  async function turnOn() {
    await run("Turn on ticket backup", async () => {
      const p = provider();
      if (!p) throw new Error("Connect a browser wallet first.");
      const w = createWalletClient({ chain, transport: custom(p) });
      const first = await w.signMessage({
        account: wallet as Address,
        message: TICKET_SYNC_MESSAGE,
      });
      const second = await w.signMessage({
        account: wallet as Address,
        message: TICKET_SYNC_MESSAGE,
      });
      // The backup key comes from the signature. A wallet that signs differently each time
      // couldn't open its own backup later, so refuse it up front.
      if (first.slice(0, 130).toLowerCase() !== second.slice(0, 130).toLowerCase())
        throw new Error(
          "Your wallet gave two different signatures for the same message, so it can't hold a ticket backup. Use a standard wallet such as MetaMask or Rabby.",
        );
      const k = syncKeysFromSignature(first);
      // Restore first: add every backed-up ticket this device doesn't have yet.
      let restored = 0;
      backedUp.current = [];
      const blob = await sdk.pullBackup(k);
      if (blob) {
        const data = await openBackup(blob, k.encKey);
        const local = readTickets(wallet);
        for (const row of Array.isArray(data) ? data : []) {
          if (!isSavedTicket(row)) continue;
          if (!trustedVault(row.ticket.vault, "v2") && !trustedVault(row.ticket.vault, "v3"))
            continue;
          backedUp.current.push(row);
          if (local.some((t) => sameTicket(t, row))) continue;
          addTicket(row);
          local.push(row);
          restored++;
        }
      }
      setKeys(k);
      await push(k);
      setMessage(
        restored
          ? `Ticket backup is on. Restored ${restored} ticket${restored === 1 ? "" : "s"} from your backup.`
          : "Ticket backup is on. New tickets are backed up automatically while this page is open.",
      );
    });
  }

  // While on, back up whenever the ticket list changes (debounced).
  useEffect(() => {
    if (!keys) return;
    const timer = setTimeout(() => {
      push(keys).catch((e: unknown) => setStatus(`Backup failed: ${errorMessage(e)}`));
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, tickets]);

  return (
    <div className="v2-fresh-wallet">
      <div className="v2-fresh-actions">
        <CloudUpload size={16} />
        <strong>Ticket backup</strong>
      </div>
      {keys ? (
        <>
          <p className="field-help">
            On for this visit. Tickets are encrypted in your browser before they're backed up;
            Curtain can't read them or tell which wallet they belong to.
          </p>
          {status && <p className="field-help">{status}</p>}
          <div className="v2-fresh-actions">
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void run("Back up tickets", async () => {
                  lastPushed.current = "";
                  await push(keys);
                })
              }
            >
              Back up now
            </button>
            <button className="text-button" onClick={() => setKeys(undefined)}>
              Turn off for this visit
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="field-help">
            Back up your escape tickets, encrypted with a key only your wallet can recreate, and
            restore them on any device by signing again. Your wallet asks you to sign twice; it's
            free and nothing goes on-chain.
          </p>
          <button className="button gold" disabled={!!busy} onClick={() => void turnOn()}>
            Turn on backup & restore
          </button>
        </>
      )}
    </div>
  );
}
