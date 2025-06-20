import type { Handler } from '@netlify/functions';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { getSwapAmountFromQuoteToBase, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';

// CORS & common headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function solToLamports(sol: number | string): BN {
  return new BN(Math.floor(parseFloat(sol.toString()) * 1e9));
}

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
    console.log('estimate-amount-out', typeof event.body);
    const { config, buyAmountSol } = JSON.parse(event.body || '{}');
    // Validate input
    if (!config || typeof buyAmountSol !== 'number') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid input' }) };
    }
    // Expect at least two points to define the first segment
    if (!Array.isArray(config.curve) || config.curve.length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Curve data is missing or invalid' }) };
    }

    
    console.log('buyAmountSol', buyAmountSol);

    // Convert buy amount in SOL to lamports (BN)
    const inLamports = solToLamports(buyAmountSol);
    console.log('inLamports', inLamports);

    console.log('config.curve[0].sqrtPrice', config.curve[0].sqrtPrice);
    // Parse first segment parameters
    const sqrtMinPrice = new BN(config.curve[0].sqrtPrice, 16);
    console.log('sqrtMinPrice', sqrtMinPrice, sqrtMinPrice.toString());
    const sqrtNextBoundary = new BN(config.curve[1].sqrtPrice, 16);
    console.log('sqrtNextBoundary', sqrtNextBoundary, sqrtNextBoundary.toString());
    const liquidity = new BN(config.curve[0].liquidity, 16);
    console.log('liquidity', liquidity, liquidity.toString());
    // Estimate swap across full bonding curve
    const curvePoints = config.curve.map((pt: any) => ({
      sqrtPrice: new BN(pt.sqrtPrice, 16),
      liquidity: new BN(pt.liquidity, 16),
    }));
    // Ensure current price is slightly below first segment to include it
    const startSqrtPrice = sqrtMinPrice.sub(new BN(1));
    let amountOut: BN;
    try {
      const swapResult = getSwapAmountFromQuoteToBase(
        { curve: curvePoints },
        startSqrtPrice,
        inLamports
      );
      amountOut = swapResult.outputAmount;
      console.log('swapResult', swapResult);
    } catch (err: any) {
      console.warn('Swap estimation failed, using linear fallback:', err.message || err);
      // Fallback: approximate base tokens = floor(buyAmountSol / startPrice) * 10^decimals
      const decimals = 9;
      const priceStart = getPriceFromSqrtPrice(sqrtMinPrice, decimals, decimals);
      const priceNum = parseFloat(priceStart.toFixed(decimals));
      const approxTokens = Math.floor(buyAmountSol / priceNum * Math.pow(10, decimals));
      amountOut = new BN(approxTokens.toString());
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ amountIn: inLamports.toString(), amountOut: amountOut.toString() }),
    };
  } catch (error: any) {
    console.error('estimate-amount-out error', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};