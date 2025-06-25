import { Handler } from '@netlify/functions';
import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed; use GET' }) };
  }

  try {
    // Get current timestamp
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // Fetch all v2 tokens from leaderboard
    const allTokens = await redis.zrange('leaderboard:v2', 0, -1, { withScores: true, rev: true });
    const totalTokensLaunched = allTokens.length / 2; // Each token has address + score

    // Fetch recent tokens from the last 24 hours (by score)
    const recentTokens = await redis.zrange(
      'leaderboard:launchTime',
      oneDayAgo,
      now,
      { withScores: true, byScore: true }
    );
    const tokensLaunched24h = recentTokens.length / 2;

    // Process tokens to calculate aggregated stats
    let totalLiquidityUSD = 0;
    let totalVolumeUSD = 0;
    let totalMarketCapUSD = 0;
    let graduatedTokens = 0;
    let activeWallets = new Set<string>();
    let topGainer = { symbol: '', change: 0, mint: '' };
    let topVolume = { symbol: '', volume: 0, mint: '' };

    // Fetch recent pools via Jupiter Gems API and aggregate liquidity, volume, and market cap
    try {
      const gemsRes = await fetch('https://datapi.jup.ag/v1/pools/gems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({"recent":{"timeframe":"24h","partnerConfigs":["5qFr4HPkn64TS3uGYXzBWqgAaLQLKxPvAbwcXBDNAujf"]},"graduated":{"timeframe":"24h","partnerConfigs":["5qFr4HPkn64TS3uGYXzBWqgAaLQLKxPvAbwcXBDNAujf"]},"aboutToGraduate":{"timeframe":"24h","partnerConfigs":["5qFr4HPkn64TS3uGYXzBWqgAaLQLKxPvAbwcXBDNAujf"]}}),
      });
      if (gemsRes.ok) {
        const gemsJson = await gemsRes.json();
        const pools: any[] = gemsJson.recent?.pools || [];
        graduatedTokens = (gemsJson.graduated?.pools?.length) || 0;
        // Fetch asset details for each pool to get liquidity, stats, and mcap
        const assetDetails = await Promise.all(
          pools.map((p: any) =>
            fetch(
              `https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(
                p.baseAsset.id
              )}&limit=1`
            )
              .then(async (r) => (r.ok ? (await r.json())[0] : null))
              .catch(() => null)
          )
        );
        pools.forEach((p: any, idx: number) => {
          const asset = assetDetails[idx];
          if (!asset) return;
          const mint = asset.id;
          const symbol = asset.symbol;
          const liquidity = Number(asset.liquidity || 0);
          const buyVol = Number(asset.stats24h?.buyVolume || 0);
          const sellVol = Number(asset.stats24h?.sellVolume || 0);
          const volume = buyVol + sellVol;
          const mcap = Number(asset.mcap || 0);
          totalLiquidityUSD += liquidity;
          totalVolumeUSD += volume;
          totalMarketCapUSD += mcap;
          const priceChange = Number(asset.stats24h?.priceChange || 0);
          if (priceChange > topGainer.change) {
            topGainer = { symbol, change: priceChange, mint };
          }
          if (volume > topVolume.volume) {
            topVolume = { symbol, volume, mint };
          }
        });
      } else {
        console.warn('Gems API HTTP error', gemsRes.status);
      }
    } catch (e: any) {
      console.error('Error fetching Gems API:', e);
    }

    // Calculate average metrics
    const avgGraduationTime = graduatedTokens > 0 ? 4.2 : 0; // Mock 4.2 hours average
    const activeUsers24h = activeWallets.size * 50; // Estimate 50 users per creator wallet
    const totalTransactions = totalTokensLaunched * 850; // Estimate 850 txs per token

    // Fetch tokens launched in the last hour (by score)
    const recentHourTokens = await redis.zrange(
      'leaderboard:launchTime',
      oneHourAgo,
      now,
      { byScore: true }
    );
    const tokensLaunchedLastHour = recentHourTokens.length;

    // Create response
    const stats = {
      totalTokensLaunched,
      tokensLaunched24h,
      tokensLaunchedLastHour,
      totalVolumeUSD,
      totalLiquidityUSD,
      activeUsers24h,
      totalTransactions,
      graduatedTokens,
      averageGraduationTime: avgGraduationTime,
      topGainer24h: topGainer,
      topVolume24h: topVolume,
      lastUpdated: now,
      marketCap24h: totalMarketCapUSD,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(stats),
    };
  } catch (err: any) {
    console.error('Error fetching platform stats:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
}; 