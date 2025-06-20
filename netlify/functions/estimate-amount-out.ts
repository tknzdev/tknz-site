import type { Handler } from '@netlify/functions';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import {
  getNextSqrtPriceFromInput,
  getDeltaAmountBaseUnsigned,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

// CORS & common headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Estimate amount of base tokens received for a given buy amount (in SOL) on initial pool creation.
 * Expects the bonding curve config object with a `curve` array of segments,
 * each having `sqrtPrice` and `liquidity` fields (as string or number).
 */
export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { config, buyAmountSol } = JSON.parse(event.body || '{}');
    // Validate input
    if (!config || typeof buyAmountSol !== 'number') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid input' }) };
    }
    // Expect at least two points to define the first segment
    if (!Array.isArray(config.curve) || config.curve.length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Curve data is missing or invalid' }) };
    }

    // Convert buy amount in SOL to lamports (BN)
    const inLamports = new BN(Math.floor(buyAmountSol * LAMPORTS_PER_SOL).toString());

    // Parse first segment parameters
    const sqrtMinPrice = new BN(config.curve[0].sqrtPrice);
    const sqrtNextBoundary = new BN(config.curve[1].sqrtPrice);
    const liquidity = new BN(config.curve[0].liquidity);

    // Compute the post-swap sqrtPrice within the first segment
    const nextSqrtPrice = getNextSqrtPriceFromInput(
      sqrtMinPrice,
      liquidity,
      inLamports,
      /* quoteForBase = */ false
    );
    // Compute amount of base tokens minted (quote → base)
    const amountOut = getDeltaAmountBaseUnsigned(
      sqrtMinPrice,
      nextSqrtPrice,
      liquidity,
      /* roundDown = */ 1
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ amountOut: amountOut.toString() }),
    };
  } catch (error: any) {
    console.error('estimate-amount-out error', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};