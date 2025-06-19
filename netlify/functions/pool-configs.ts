import { Handler } from '@netlify/functions';
import { Redis } from '@upstash/redis';
import process from 'process';

// Initialize Redis client
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });

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
    // Fetch recent config keys
    const raw = await redis.zrange('poolConfigKeys', -500, -1, { rev: true });
    const keys: string[] = Array.isArray(raw) ? raw.map(String) : [];
    // Bulk fetch all config hashes via Redis pipeline
    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.hgetall(`pool:${key}:config`);
    }
    const results = await pipeline.exec();
    const configs: any[] = [];
    for (const data of results) {
      // Each data is a record of string->string or empty object
      if (data && Object.keys(data).length > 0) {
        // Parse JSON fields
        if (data.config) {
          try { data.config = JSON.parse(data.config); } catch {}
        }
        configs.push(data);
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ configs }) };
  } catch (err: any) {
    console.error('Error fetching pool configs:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
}; 