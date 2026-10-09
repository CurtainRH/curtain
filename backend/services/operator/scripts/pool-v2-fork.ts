// Run against a disposable Anvil fork only. No production signer is loaded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, erc20Abi, encodeAbiParameters, toHex, type Address } from 'viem';
import { buildPoseidon } from 'circomlibjs';
import { migrate } from '@curtain/db';
import { pgliteDb } from '@curtain/db/pglite';
import { PoolV2RootPublisher } from '../src/poolV2';
import { writeContract } from 'viem/actions';

const rpc = process.env.POOL_V2_FORK_RPC ?? 'http://127.0.0.1:18545';
assert(['localhost', '127.0.0.1'].includes(new URL(rpc).hostname), 'Fork RPC must be local');
const client = createPublicClient({ transport: http(rpc) });
const request = (method: string, params: unknown[] = []) => client.request({ method, params } as never);
assert(String(await request('web3_clientVersion')).toLowerCase().includes('anvil'), 'Anvil required');
const snapshot = await request('evm_snapshot');
try {
  const [publisher, user, recipient] = await request('eth_accounts') as Address[];
  await request('anvil_setBalance', [publisher, '0x56bc75e2d63100000']);
  const wallet = (account: Address) => createWalletClient({ account, transport: http(rpc) }).extend(c => ({
    writeContract: (args: any) => writeContract(c, { ...args, chain: null, gas: 3000000n }),
  }));
  const abi = parseAbi(['function shield(address,uint256,bytes32)', 'function unshield(bytes,bytes32,bytes32,address,uint256,address)', 'function knownRoot(bytes32) view returns(bool)']);
  const mined = async (hash: `0x${string}`) => assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
  const artifact = (path: string) => JSON.parse(readFileSync(new URL(`../../../contracts/out/${path}`, import.meta.url), 'utf8'));
  const deploy = async (path: string, args: unknown[] = []) => {
    const a = artifact(path);
    const bytecode = a.bytecode.object.startsWith('0x') ? a.bytecode.object : `0x${a.bytecode.object}`;
    // A Robinhood Chain fork retains its live fee history. Bound gas explicitly so
    // Anvil does not use the fork's enormous block gas limit as a transaction limit.
    const hash = await wallet(publisher!).deployContract({
      chain: null,
      abi: a.abi,
      bytecode,
      args,
      gas: 3_000_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1n,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    assert(receipt.contractAddress);
    return receipt.contractAddress;
  };
  const token = await deploy('MockERC20.sol/MockERC20.json', ['Test USDG', 'tUSDG']);
  const generatedTransfer = await deploy('PoolV2TransferGroth16VerifierV2.sol/PoolV2TransferGroth16VerifierV2.json');
  const generatedUnshield = await deploy('PoolV2UnshieldGroth16VerifierV2.sol/PoolV2UnshieldGroth16VerifierV2.json');
  const transferAdapter = await deploy('PoolV2TransferVerifierAdapter.sol/PoolV2TransferVerifierAdapter.json', [generatedTransfer]);
  const unshieldAdapter = await deploy('PoolV2UnshieldVerifierAdapter.sol/PoolV2UnshieldVerifierAdapter.json', [generatedUnshield]);
  const manager = await deploy('PoolV2RootManager.sol/PoolV2RootManager.json', [publisher, publisher]);
  const pool = await deploy('CurtainPoolV2.sol/CurtainPoolV2.json', [transferAdapter, unshieldAdapter, [token], manager, []]);
  const managerAbi = parseAbi(['function setPool(address)']);
  await mined(await wallet(publisher!).writeContract({ chain: null, address: manager, abi: managerAbi, functionName: 'setPool', args: [pool] }));
  await mined(await wallet(publisher!).writeContract({ chain: null, address: token, abi: parseAbi(['function mint(address,uint256)']), functionName: 'mint', args: [user!, 2000000n] }));
  await mined(await wallet(user!).writeContract({ chain: null, address: token, abi: erc20Abi, functionName: 'approve', args: [pool, 2000000n] }));
  const startBlock = await client.getBlockNumber({ cacheTime: 0 });
  const poseidon = await buildPoseidon();
  const commitment = (secret: bigint) => toHex(poseidon.F.toObject(poseidon([secret, BigInt(token), 1000000n])), { size: 32 });
  for (const secret of [111n, 222n]) await mined(await wallet(user!).writeContract({ chain: null, address: pool, abi, functionName: 'shield', args: [token, 1000000n, commitment(secret)] }));
  const db = await pgliteDb();
  await migrate(db);
  const indexer = new PoolV2RootPublisher({ db, publicClient: client as never, walletClient: wallet(publisher) as never, pool, rootManager: manager, startBlock });
  const synced = await indexer.sync();
  assert.equal(synced.added, 2);
  assert(await client.readContract({ address: pool, abi, functionName: 'knownRoot', args: [synced.root!] }));
  console.log('PASS: deployed Pool V2 shield, index and root publication');
  const witness = await indexer.witness(commitment(111n));
  assert(witness);
  const requireCircuits = createRequire(new URL('../../../circuits/package.json', import.meta.url));
  const { groth16 } = requireCircuits('snarkjs');
  const assets = new URL('../../../circuits/', import.meta.url).pathname;
  async function prove() {
    const { proof, publicSignals } = await groth16.fullProve({ secret: '111', tokenId: BigInt(token).toString(), amount: '1000000', siblings: witness!.siblings.map(x => BigInt(x).toString()), pathBits: witness!.pathBits, recipient: BigInt(recipient!).toString() }, assets + 'pool_unshield_js/pool_unshield.wasm', assets + 'pool_unshield_v2.zkey', undefined, undefined, { singleThread: true });
    const encoded = encodeAbiParameters([{type:'uint256[2]'}, {type:'uint256[2][2]'}, {type:'uint256[2]'}, {type:'uint256[5]'}], [proof.pi_a.slice(0,2).map(BigInt), proof.pi_b.slice(0,2).map((r:string[]) => r.slice(0,2).reverse().map(BigInt)), proof.pi_c.slice(0,2).map(BigInt), publicSignals.map(BigInt)] as never);
    return [encoded, witness!.root, toHex(BigInt(publicSignals[1]), { size: 32 }), token, 1000000n, recipient!] as const;
  }
  const before = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [recipient!] });
  const args = await prove();
  await mined(await wallet(user!).writeContract({ chain: null, address: pool, abi, functionName: 'unshield', args }));
  assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [recipient!] }), before + 1000000n);
  console.log('PASS: production proof verified and output delivered on fork');
  await assert.rejects(client.simulateContract({ account: user, address: pool, abi, functionName: 'unshield', args }));
  console.log('PASS: exact proof replay rejected');
} finally {
  await request('evm_revert', [snapshot]);
}
