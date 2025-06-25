import { Buffer } from 'buffer';

export async function createTokenMetadata(token: {
  name: string;
  ticker: string;
  imageUrl: string;
  description: string;
  websiteUrl?: string;
  twitter?: string;
  telegram?: string;
}): Promise<{ name: string; symbol: string; uri: string; imageUrl: string }> {
  const { name, ticker: symbol, description, imageUrl, websiteUrl, twitter, telegram } = token;
  if (!imageUrl) throw new Error('createTokenMetadata: missing imageUrl');

  // 1. Prepare image blob
  let blob: Blob;
  if (imageUrl.startsWith('data:')) {
    const [meta, base64] = imageUrl.split(',');
    const mime = meta.split(':')[1].split(';')[0];
    const buf = Buffer.from(base64, 'base64');
    blob = new Blob([buf], { type: mime });
  } else {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`createTokenMetadata: failed to fetch image (${res.status}): ${res.statusText}`);
    blob = await res.blob();
  }

  // Ensure JWT is provided for Pinata authentication
  const jwt = process.env.PINATA_JWT_KEY;
  if (!jwt) {
    throw new Error('PINATA_JWT_KEY environment variable is required');
  }
  const authHeaders = { Authorization: `Bearer ${jwt}` };
  // 2. Upload image to Pinata
  const imgForm = new FormData();
  imgForm.append('file', blob);
  // following Pinata Quickstart: include options and metadata
  imgForm.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  imgForm.append('pinataMetadata', JSON.stringify({ name }));
  const pinFileRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: authHeaders,
    body: imgForm,
  });
  if (!pinFileRes.ok) {
    const txt = await pinFileRes.text();
    throw new Error(`createTokenMetadata: pinFileToIPFS failed: ${txt}`);
  }
  const { IpfsHash: imageHash } = await pinFileRes.json();
  const imageIpfs = `ipfs://${imageHash}`;
  // Prepare gateway URL (no trailing slash)
  const gatewayUrl = process.env.PINATA_GATEWAY_URL?.replace(/\/+$/, '') || '';
  const imageForMetadata = gatewayUrl
    ? `${gatewayUrl}/ipfs/${imageHash}`
    : imageIpfs;

  // 3. Build metadata JSON
  const metadata: Record<string, any> = {
    name,
    symbol,
    description,
    image: imageForMetadata,
  };
  if (websiteUrl) metadata.external_url = websiteUrl;
  metadata.attributes = [];
  const exts: Record<string,string> = {};
  if (twitter) exts.twitter = twitter;
  if (telegram) exts.telegram = telegram;
  if (Object.keys(exts).length) metadata.extensions = exts;

  // 4. Pin JSON to Pinata
  const pinJsonRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      pinataOptions: { cidVersion: 1 },
      pinataMetadata: { name: `${name}-metadata` },
      pinataContent: metadata,
    }),
  });
  if (!pinJsonRes.ok) {
    const txt = await pinJsonRes.text();
    throw new Error(`createTokenMetadata: pinJSONToIPFS failed: ${txt}`);
  }
  const { IpfsHash: metaHash } = await pinJsonRes.json();
  const uriResult = gatewayUrl
    ? `${gatewayUrl}/ipfs/${metaHash}`
    : `ipfs://${metaHash}`;
  return { name, symbol, uri: uriResult, imageUrl: imageForMetadata };
}