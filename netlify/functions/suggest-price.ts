import type { Handler } from '@netlify/functions';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { getSwapAmountFromQuoteToBase as estimateAmountOut } from '@meteora-ag/dynamic-bonding-curve-sdk';

// CORS & common headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Convert SOL amount to lamports (BN)
 */
function solToLamports(sol: number): BN {
  return new BN(Math.floor(sol * LAMPORTS_PER_SOL));
}

/**
 * Suggest optimal price given a bonding curve config and target SOL amount.
 * Expects JSON body with `config` (curve points) and `targetSol` (number).
 * Returns `tokenOut` (raw token amount) and `pricePerTokenSol` (float).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { config, targetSol } = JSON.parse(event.body || '{}');
    if (!config || typeof targetSol !== 'number') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid input' }) };
    }
    if (!Array.isArray(config.curve) || config.curve.length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Curve data is missing or invalid' }) };
    }

    // Prepare curve points and starting sqrt price
    const points = (config.curve as any[]).map(pt => ({
      sqrtPrice: new BN(pt.sqrtPrice, 16),
      liquidity: new BN(pt.liquidity, 16),
    }));
    const startSqrt = points[0].sqrtPrice.sub(new BN(1));

    // Try targetSol and fallbacks if no output
    const factors = [1, 0.75, 0.5, 0.25];
    let chosen: { sol: number; out: BN } | null = null;
    for (const f of factors) {
      const solAmt = targetSol * f;
      const lamports = solToLamports(solAmt);
      try {
        const { outputAmount } = estimateAmountOut({ curve: points }, startSqrt, lamports);
        if (outputAmount.gt(new BN(0))) {
          chosen = { sol: solAmt, out: outputAmount };
          break;
        }
      } catch {
        // continue to next factor
      }
    }
    if (!chosen) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not find a viable buy amount for this curve' }),
      };
    }
    // Compute price per token: lamports per token, then to SOL
    const lamIn = solToLamports(chosen.sol);
    const priceLamPerToken = lamIn.div(chosen.out);
    const pricePerTokenSol = (priceLamPerToken.toNumber() / LAMPORTS_PER_SOL).toString();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        suggestedBuyAmountSol: chosen.sol,
        expectedTokenOut: chosen.out.toString(),
        pricePerTokenSol,
      }),
    };
  } catch (error: any) {
    console.error('suggest-price error', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};