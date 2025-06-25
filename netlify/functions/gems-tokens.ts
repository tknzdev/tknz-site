import { Handler } from '@netlify/functions';

// Proxy for Jupiter Gems API
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed; use POST' }) };
  }
  try {
    const body = event.body || '{}';
    const res = await fetch('https://datapi.jup.ag/v1/pools/gems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err: any) {
    console.error('Error in gems-tokens function:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};