import { describe, expect, test } from "bun:test";
import { createUnderstudyToolkit, UnderstudyError, type AuthorizedUnderstudyAction, type UnderstudyAccount, type UnderstudyStore } from "../src";

const current = Date.parse("2030-01-01T12:00:00.000Z");
const accounts = new Map<string, UnderstudyAccount>();
const actions = new Map<string, AuthorizedUnderstudyAction>();
const store: UnderstudyStore = {
  async getAccount(id) { return accounts.get(id); }, async createAccount(account) { if (accounts.has(account.accountId)) throw new Error("duplicate"); accounts.set(account.accountId, structuredClone(account)); },
  async putAccount(account) { accounts.set(account.accountId, structuredClone(account)); },
  async reserveAction({ action, maxAmount, gasBudget }) { const prior = actions.get(action.requestId); if (prior) return structuredClone(prior); if (BigInt(action.amount) > BigInt(maxAmount) || BigInt(action.gasAmount) > BigInt(gasBudget)) throw new Error("limit"); actions.set(action.requestId, structuredClone(action)); return structuredClone(action); },
};
const policy = { accountId: "understudy-1", controllerReference: "shielded-controller-1", recoveryReference: "recovery-path-1", purpose: "isolated-credit", expiresAt: "2030-01-02T12:00:00.000Z", gasBudget: "100000", rules: [{ venueId: "morpho", action: "borrow", assetId: "nvda", maxAmount: "5000000" }] };
function toolkit() { accounts.clear(); actions.clear(); return createUnderstudyToolkit({ store, now: () => current, authorizer: { async verifyCreate() { return true; }, async verifyRecovery() { return true; } }, provisioner: { async provision() { return { publicAccountReference: "0x1111111111111111111111111111111111111111" }; }, async prepareGasFunding({ request }) { return { unsigned: true, requestId: request.requestId }; } } }); }

describe("Understudy accounts", () => {
  test("creates a purpose-bound account and authorizes only its approved action", async () => {
    const understudies = toolkit(); const account = await understudies.create(policy, { signature: "owner" });
    expect(account.publicAccountReference).toBe("0x1111111111111111111111111111111111111111");
    expect(await understudies.authorize({ requestId: "action-1", accountId: account.accountId, venueId: "morpho", action: "borrow", assetId: "nvda", amount: "5000000", gasAmount: "20" })).toMatchObject({ status: "authorized" });
    await expect(understudies.authorize({ requestId: "action-2", accountId: account.accountId, venueId: "morpho", action: "borrow", assetId: "nvda", amount: "5000001", gasAmount: "20" })).rejects.toThrow("outside");
  });

  test("supports opaque recovery and adapter-provided gas funding without signing", async () => {
    const understudies = toolkit(); await understudies.create(policy, {});
    expect((await understudies.recover("understudy-1", "recovery-path-1", {})).accountId).toBe("understudy-1");
    expect(await understudies.prepareGasFunding({ requestId: "gas-1", accountId: "understudy-1", gasAmount: "100" })).toEqual({ unsigned: true, requestId: "gas-1" });
    await expect(understudies.recover("understudy-1", "wrong-recovery", {})).rejects.toThrow(UnderstudyError);
  });

  test("rejects duplicate, expired, revoked, and unapproved accounts/actions", async () => {
    const understudies = toolkit(); await understudies.create(policy, {});
    await expect(understudies.create(policy, {})).rejects.toThrow("already exists");
    await understudies.revoke("understudy-1");
    await expect(understudies.authorize({ requestId: "blocked", accountId: "understudy-1", venueId: "morpho", action: "borrow", assetId: "nvda", amount: "1", gasAmount: "0" })).rejects.toThrow("not active");
    const fresh = toolkit(); await expect(fresh.create({ ...policy, accountId: "expired", expiresAt: "2030-01-01T11:00:00.000Z" }, {})).rejects.toThrow("expiry");
  });
});
