import { Handler } from '@netlify/functions';
import { Redis } from '@upstash/redis';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';

// Initialize Redis client
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!event.body) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing request body' }) };
  }
  let payload: any;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  const { poolConfigKey, mint, signedConfigTx, signedPoolTx, walletAddress } = payload;
  if (!walletAddress || !poolConfigKey || !mint || !signedConfigTx || !signedPoolTx) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  // Retrieve stored keypair secrets by wallet-scoped Redis keys
  const cfgSecretJson = await redis.get(`signer:${walletAddress}:${poolConfigKey}:config`);
  const mintSecretJson = await redis.get(`signer:${walletAddress}:${mint}:mint`);
  if (!cfgSecretJson || !mintSecretJson) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Keypair not found' }) };
  }
  const cfgSecret = Uint8Array.from(JSON.parse(cfgSecretJson));
  const mintSecret = Uint8Array.from(JSON.parse(mintSecretJson));
  const configKP = Keypair.fromSecretKey(cfgSecret);
  const mintKP = Keypair.fromSecretKey(mintSecret);
  // Deserialize client-signed transactions
  let configTx: VersionedTransaction;
  let poolTx: VersionedTransaction;
  try {
    configTx = VersionedTransaction.deserialize(Buffer.from(signedConfigTx, 'base64'));
    poolTx = VersionedTransaction.deserialize(Buffer.from(signedPoolTx, 'base64'));
  } catch (err: any) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid transaction data' }) };
  }
  // Append server-side signatures
  const cfgMsg = configTx.message.serialize();
  const cfgSig = nacl.sign.detached(cfgMsg, configKP.secretKey);
  configTx.addSignature(configKP.publicKey, cfgSig);
  const poolMsg = poolTx.message.serialize();
  const mintSig = nacl.sign.detached(poolMsg, mintKP.secretKey);
  poolTx.addSignature(mintKP.publicKey, mintSig);
  // (Optionally, append other server signers here, e.g. treasury)
  // Return fully-signed transactions
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      signedConfigTx: Buffer.from(configTx.serialize()).toString('base64'),
      signedPoolTx: Buffer.from(poolTx.serialize()).toString('base64'),
    }),
  };
};