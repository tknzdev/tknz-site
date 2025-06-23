import { Handler } from '@netlify/functions';
import { Redis } from '@upstash/redis';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { Keypair, VersionedTransaction } from '@solana/web3.js';

import dotenv from 'dotenv';

dotenv.config();
// Initialize Redis client
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });

let TREASURY_KP: Keypair;

if (process.env.TREASURY_SECRET_KEY) {
  TREASURY_KP = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET_KEY))
  );
} else {
  throw new Error('TREASURY_SECRET_KEY is not set');
}

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
  const { poolConfigKey, mint, signedPoolTx, walletAddress } = payload;
  if (!walletAddress || !poolConfigKey || !mint || !signedPoolTx) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  // Retrieve stored keypair secrets by wallet-scoped Redis keys
  // Retrieve base64-encoded private keys from Redis and rebuild keypairs
  
  const mintSecretB64 = await redis.get(`signer:${walletAddress}:${mint}:mint`);
  if (!mintSecretB64) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Keypair not found' }) };
  }
  
  // Reconstruct the mint keypair from stored secret
  const mintSecret = Uint8Array.from(Buffer.from(mintSecretB64 as string, 'base64'));
  const mintKP = Keypair.fromSecretKey(mintSecret);
  
  // Deserialize client-signed transaction
  let poolTx: VersionedTransaction;
  try {
    poolTx = VersionedTransaction.deserialize(Buffer.from(signedPoolTx, 'base64'));
  } catch (err: any) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid transaction data' }) };
  }
  
  // Add server signatures (mint keypair and treasury)
  const poolMsg = poolTx.message.serialize();
  
  // Sign with mint keypair
  const mintSig = nacl.sign.detached(poolMsg, mintKP.secretKey);
  poolTx.addSignature(mintKP.publicKey, mintSig);
  
  // Sign with treasury keypair
  const treasurySig = nacl.sign.detached(poolMsg, TREASURY_KP.secretKey);
  poolTx.addSignature(TREASURY_KP.publicKey, treasurySig);
  
  // Return fully-signed transaction
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      signedPoolTx: Buffer.from(poolTx.serialize()).toString('base64')
    }),
  };
};