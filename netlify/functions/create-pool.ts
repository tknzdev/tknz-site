import type { Handler } from '@netlify/functions';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import BN from 'bn.js';

import { NATIVE_MINT, TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync } from '@solana/spl-token';
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { createTokenMetadata } from '../../src/utils/createTokenMetadata';
import { Buffer } from 'buffer';
import dotenv from 'dotenv';

dotenv.config();

// Load payer / treasury keypair from env (base58 array string) or fallback file path
let TREASURY_KP: Keypair;

if (process.env.TREASURY_SECRET_KEY) {
  TREASURY_KP = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET_KEY))
  );
} else {
  throw new Error('TREASURY_SECRET_KEY is not set');
}

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

interface TokenDetails {
  name: string;
  ticker: string;
  description: string;
  imageUrl: string; // can be data URL or remote URL
  websiteUrl?: string;
  twitter?: string;
  telegram?: string;
}

interface RequestBody {
  walletAddress: string; // poolCreator
  configKey: string; // existing config public key
  token: TokenDetails;
  /** Optional initial buy amount in SOL */
  buyAmount?: number;
}

export const handler: Handler = async (event) => {
  // CORS pre-flight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: 'ok',
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body: RequestBody = JSON.parse(event.body || '{}');
    const { walletAddress, configKey, token, buyAmount = 0 } = body;

    if (!walletAddress || !configKey || !token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'walletAddress, configKey and token are required' }),
      };
    }

    // 1. Create token metadata JSON & upload, receiving a metadata URI.
    let metadataResult;
    try {
      metadataResult = await createTokenMetadata(token);
    } catch (metaErr: any) {
      console.error('Metadata creation failed', metaErr);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: metaErr?.message || 'metadata upload failed' }),
      };
    }

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(walletAddress);
    } catch (err) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid walletAddress' }) };
    }

    let configPubkey: PublicKey;
    try {
      configPubkey = new PublicKey(configKey);
    } catch (err) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid configKey' }) };
    }

    let { name, symbol, uri } = metadataResult;

    // Metaplex limits safeguard
    const MAX_NAME_LEN = 32;
    const MAX_SYMBOL_LEN = 10;
    
    if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);
    if (symbol.length > MAX_SYMBOL_LEN) symbol = symbol.slice(0, MAX_SYMBOL_LEN);
    

    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

    // Generate base mint keypair that will back the pool
    const baseMintKeypair = Keypair.generate();

    // Determine buy lamports (optional initial buy)
    const buyLamports = Math.floor(buyAmount * LAMPORTS_PER_SOL);
    let transaction;
    if (buyLamports > 0) {
      // Create pool and immediately swap buyAmount
      transaction = await dbcClient.pool.createPoolWithFirstBuy({
        baseMint: baseMintKeypair.publicKey,
        config: configPubkey,
        name,
        symbol,
        uri,
        payer: TREASURY_KP.publicKey,
        poolCreator: userPubkey,
        buyAmount: new BN(buyLamports),
      });
    } else {
      // Standard pool creation only
      transaction = await dbcClient.pool.createPool({
        baseMint: baseMintKeypair.publicKey,
        config: configPubkey,
        name,
        symbol,
        uri,
        payer: TREASURY_KP.publicKey,
        poolCreator: userPubkey,
      });
    }

    const poolAddress = deriveDbcPoolAddress(
      NATIVE_MINT,
      baseMintKeypair.publicKey,
      configPubkey
    );

    const ata = getAssociatedTokenAddressSync(baseMintKeypair.publicKey, userPubkey, true, TOKEN_PROGRAM_ID);

    console.log('Derived DBC pool address:', poolAddress.toBase58());

    // Build versioned transaction and presign with treasury + baseMint
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const message = new TransactionMessage({
      payerKey: TREASURY_KP.publicKey,
      recentBlockhash: blockhash,
      instructions: transaction.instructions,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(message);
    vtx.sign([baseMintKeypair, TREASURY_KP]);

    const serialized = vtx.serialize();
    const txBase64 = Buffer.from(serialized).toString('base64');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        transactions: [txBase64],
        ata: ata.toBase58(),
        mint: baseMintKeypair.publicKey.toBase58(),
        tokenMetadata: metadataResult,
        pool: poolAddress.toBase58(),
        poolConfigKey: configKey,
        feeSol: 0.0001, // todo derive the fee from the config
        feeLamports: 100000, // todo derive the fee from the config
        metadataUri: uri,
        // Echo buy amounts
        buySol: buyAmount,
        buyLamports,
      }),
    };
  } catch (error: any) {
    console.error('create-pool error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error?.message || 'internal error' }),
    };
  }
};
