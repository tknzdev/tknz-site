import { Handler } from '@netlify/functions';
import { Redis } from '@upstash/redis';
import process from 'process';

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
    // Fetch up to 10 most recent poolConfigKeys (highest score first)
    const raw = await redis.zrange('dbc:config:keys', -10, -1, { rev: true });
    const keys = Array.isArray(raw) ? raw.map(String) : [];
    return { statusCode: 200, headers, body: JSON.stringify({ keys }) };
  } catch (err: any) {
    console.error('Error fetching poolConfigKeys:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};