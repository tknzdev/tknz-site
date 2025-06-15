#!/usr/bin/env ts-node-esm
import nacl from 'tweetnacl';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Load .env
dotenv.config();
/**
 * Test harness to emulate frontend token creation via the create-token-meteora function.
 *
 * Prerequisites:
 *   - Netlify Dev running on http://localhost:8888
 *   - Solana Test Validator running on http://localhost:8899
 *   - Environment vars RPC_ENDPOINT and CP_AMM_STATIC_CONFIG set for Netlify Dev
 */
import axios from 'axios';
import { Keypair, VersionedTransaction, Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
// Setup debug output to file and override exit to capture all data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const debugPath = path.resolve(__dirname, '../logs/create-token-debug.json');
const debug: any = { startedAt: new Date().toISOString() };
const origExit = process.exit.bind(process);
(process as any).exit = (code?: any) => { fs.writeFileSync(debugPath, JSON.stringify(debug, null, 2)); origExit(code); };

/**
 * Utility to log signature slots by matching message staticAccountKeys
 */
function logSignatureSlots(tx: VersionedTransaction, label: string) {
  const reqSigs = tx.message.header.numRequiredSignatures;
  const signerKeys = tx.message.staticAccountKeys.slice(0, reqSigs).map(k => k.toBase58());
  const slots = tx.signatures.map(sig => !sig.every(b => b === 0));
  console.log(label, signerKeys.map((pk, i) => ({ pubkey: pk, present: slots[i] })));
}

/**
 * Emulate wallet signing behavior (like Phantom)
 * Standard wallets use the built-in signing methods from Solana Web3.js
 */
function walletSignTransaction(tx: VersionedTransaction, wallet: Keypair): VersionedTransaction {
  // Clone the transaction to avoid mutating the original
  const signedTx = VersionedTransaction.deserialize(tx.serialize());
  
  // Use the standard Solana Web3.js signing method
  // This is how wallets typically sign transactions internally
  signedTx.sign([wallet]);
  
  return signedTx;
}

/**
 * Emulate wallet's signAllTransactions method
 * This mimics how wallets like Phantom sign multiple transactions at once
 */
function walletSignAllTransactions(txs: VersionedTransaction[], wallet: Keypair): VersionedTransaction[] {
  return txs.map(tx => walletSignTransaction(tx, wallet));
}

async function main() {
  // Configuration from environment
  const FUNCTION_URL_ENV = process.env.CREATE_TOKEN_URL || process.env.FUNCTION_URL;

  let useHttp = Boolean(FUNCTION_URL_ENV);
  const FUNCTION_URL = FUNCTION_URL_ENV ?? 'local-handler';
  // We no longer interact with a running Solana validator in the default test
  // harness.  The endpoint under test already returns fully-signed transactions
  // with a dummy block-hash so sending them to an RPC node is not necessary and
  // would in fact fail in CI environments where no validator is present.  A
  // custom RPC endpoint can still be provided via the `RPC_ENDPOINT` env var if
  // manual end-to-end testing on a live cluster is desired.

  const RPC_ENDPOINT = process.env.SOLANA_RPC_URL; // optional

  console.log('Function URL:', FUNCTION_URL);
  if (RPC_ENDPOINT) {
    console.log('RPC Endpoint:', RPC_ENDPOINT);
  } else {
    console.log('RPC Endpoint:  (skipped – not provided)');
  }

  // Load creator wallet keypair from config/keys/creator.json
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const keyPath = path.resolve(__dirname, '../config/keys/creator.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Creator key file not found at ${keyPath}`);
  }
  const secret = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log('Loaded creator wallet:', wallet.publicKey.toBase58());
  // Load image data (trim whitespace), may be a data URI (base64) or a direct URL
  
  // --------------------------------------------------------------------------------
  // Test parameters – tweak these two values to experiment with different scenarios
  // --------------------------------------------------------------------------------
  const DEPOSIT_SOL = 0.01; // SOL that will seed the bonding-curve pool (quote side)
  const BUY_SOL = 0.01;     // SOL that the creator spends to immediately buy tokens

  // Prepare token metadata for creation (bare minimum)
  const payload = {
    walletAddress: wallet.publicKey.toBase58(),
    token: {
      name: 'TOM and Jerry',
      ticker: 'TOMJ',
      description: 'TOM and Jerry',
      websiteUrl: 'https://tknz.fun',
      twitter: 'https://x.com/tknzfun',
      telegram: 'https://t.me/tknzfun',
      imageUrl: 'https://ipfs.io/ipfs/QmcKySr5B4UPqDAoGekP2nSxX63fJTtXmuRXGGt4cDkyZF'
    },
    isLockLiquidity: false,
    portalParams: {
      amount: DEPOSIT_SOL,
      buyAmount: BUY_SOL,
      priorityFee: 0,
      curveConfig: {},
    },
  };
  
  console.log('Request payload:', payload);
  // record payload for debugging
  debug.payload = payload;

  // Call the create-token endpoint
  let data: any;
  
  try {
    const resp = await axios.post(FUNCTION_URL, payload, { headers: { 'Content-Type': 'application/json' } });
    if (resp.status !== 200) {
      console.error('HTTP error status:', resp.status, 'body:', resp.data);
      throw new Error(`HTTP error ${resp.status}`);
    }
    data = resp.data;
    debug.functionResponse = { status: resp.status, data };
  } catch (httpErr: any) {
    console.error(
      'HTTP call failed:',
      httpErr.response?.status,
      httpErr.response?.data,
      httpErr.message || httpErr
    );
    process.exit(1);
  }
  


  console.log('Function response:', data);

  // Deserialize the VersionedTransactions
  if (!Array.isArray(data.transactions) || data.transactions.length === 0) {
    throw new Error('No transactions returned from create-token-meteora');
  }

  const txs = data.transactions.map((b64: string, idx: number) => {
    const buf = Buffer.from(b64, 'base64');
    const tx = VersionedTransaction.deserialize(buf);
    console.log(`Deserialized tx ${idx} – version:`, tx.message.version);
    return tx;
  });

  // 1) Client-side signing - Emulate standard wallet behavior
  console.log('Emulating wallet signing (like Phantom)...');
  
  // Use the wallet signing emulation functions
  const signedTxs = walletSignAllTransactions(txs, wallet);
  
  // Convert signed transactions to base64 strings
  const clientSignedB64s = signedTxs.map((tx, idx) => {
    logSignatureSlots(tx, `Client-signed tx ${idx} (wallet emulation)`);
    return Buffer.from(tx.serialize()).toString('base64');
  });

  // 2) Server-side counter-signing via sign-token-txs endpoint
  const SIGN_URL = process.env.SIGN_TOKEN_URL || FUNCTION_URL.replace('create-token-meteora', 'sign-token-txs');
  console.log('POST to sign-token-txs:', SIGN_URL, {
    walletAddress: wallet.publicKey.toBase58(), poolConfigKey: data.poolConfigKey, mint: data.mint
  });
  const signResp = await axios.post(SIGN_URL, {
    walletAddress: wallet.publicKey.toBase58(),
    poolConfigKey: data.poolConfigKey,
    mint: data.mint,
    signedConfigTx: clientSignedB64s[0],
    signedPoolTx: clientSignedB64s[1],
  }, { headers: { 'Content-Type': 'application/json' } });
  console.log('sign-token-txs response:', signResp.status, signResp.data);
  const { signedConfigTx, signedPoolTx } = signResp.data;
  // 3) Decode and display signatures after server signing
  // 3) Decode and display signatures after server signing
  [signedConfigTx, signedPoolTx].forEach((b64, idx) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
    logSignatureSlots(tx, `Server-signed tx ${idx}`);
  });

  // 4) Broadcast fully-signed transactions to chain
  let connection: Connection | undefined;
  if (RPC_ENDPOINT) {
    connection = new Connection(RPC_ENDPOINT, 'confirmed');
    for (let i = 0; i < 2; i++) {
      const raw = Buffer.from([signedConfigTx, signedPoolTx][i], 'base64');
      console.log(`Sending fully-signed tx ${i}...`);
      const tx = VersionedTransaction.deserialize(raw);
      let sig;
      try {
        sig = await connection.sendRawTransaction(raw, { skipPreflight: true });
        console.log(`Submitted final tx ${i} sig:`, sig);
      } catch (err: any) {
        console.error(`Error submitting final tx ${i}:`, err);
        process.exit(1);
      }
      const conf = await connection.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) {
        console.error(`Final tx ${i} on-chain error:`, conf.value.err);
        process.exit(1);
      }
      console.log(`Final tx ${i} finalized on-chain.`);
    }
  } else {
    console.warn('RPC_ENDPOINT not provided; skipping on-chain send');
  }

  // No manual swap: backend already includes swap Tx when buyAmount>0.

  // verify on-chain accounts
  debug.accounts = {};
  if (connection) {
    const toCheck: Record<string, string> = {
      mint: data.mint,
      ata: data.ata,
      pool: data.pool,
    };
    for (const [name, addr] of Object.entries(toCheck)) {
      try {
        const info = await connection.getAccountInfo(new PublicKey(addr));
        console.log(`${name} (${addr}) on-chain?`, info ? 'yes' : 'no');
        debug.accounts[name] = info ? { lamports: info.lamports, owner: info.owner.toBase58() } : null;
      } catch (e) {
        console.error(`Error fetching ${name}:`, e);
      }
    }
  }
  if (useHttp) {
    // Record confirmed token creation in v2 leaderboard via confirm-token-creation
    const CONFIRM_URL = process.env.CONFIRM_TOKEN_URL || FUNCTION_URL.replace('create-token-meteora', 'confirm-token-creation');
    const confirmPayload = {
      mint: data.mint,
      ata: data.ata,
      pool: data.pool,
      metadataUri: data.metadataUri,
      decimals: data.decimals,
      initialSupply: data.initialSupply,
      initialSupplyRaw: data.initialSupplyRaw,
      depositSol: data.depositSol,
      depositLamports: data.depositLamports,
      feeSol: data.feeSol,
      feeLamports: data.feeLamports,
      isLockLiquidity: data.isLockLiquidity,
      walletAddress: payload.walletAddress,
      token: { ...payload.token },
      portalParams: payload.portalParams,
    };
    let confirmResp: any;
    console.log('Posting to confirm endpoint:', CONFIRM_URL, confirmPayload);
    try {
      confirmResp = await axios.post(CONFIRM_URL, confirmPayload, { headers: { 'Content-Type': 'application/json' } });
      console.log('Confirm endpoint response:', confirmResp.status, confirmResp.data);
      debug.confirm = { status: confirmResp.status, data: confirmResp.data };
    } catch (err: any) {
      console.error('Error calling confirm-token-creation endpoint:', err.message || err);
    }
    
    const NOTIFY_URL = process.env.NOTIFY_URL || CONFIRM_URL.replace('confirm-token-creation', 'notify-token-creation');
    console.log('Posting to notify endpoint:', NOTIFY_URL, confirmPayload);
    try {
      const notifyResp = await axios.post(
        NOTIFY_URL,
        { ...confirmPayload, createdAt: confirmResp?.data?.createdAt ?? Date.now() },
        { headers: { 'Content-Type': 'application/json' } }
      );
      console.log('Notify endpoint response:', notifyResp.status, notifyResp.data);
      debug.notify = { status: notifyResp.status, data: notifyResp.data };
    } catch (err: any) {
      console.error('Error calling notify-token-creation endpoint:', err.message || err);
    }
  }
  // write collected debug information to file
  fs.writeFileSync(debugPath, JSON.stringify(debug, null, 2));
  console.log('Debug info written to', debugPath);
}

main().catch(err => {
  console.error('Error in test-create-token:', err);
  process.exit(1);
});