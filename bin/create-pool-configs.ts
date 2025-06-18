#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import process from 'process';
import { Keypair, Connection, VersionedTransaction, TransactionMessage, TransactionInstruction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import dotenv from 'dotenv';
import { Redis } from '@upstash/redis';
import { Buffer } from 'buffer';
import BN from 'bn.js';
import { DynamicBondingCurveClient, bpsToFeeNumerator, FeeSchedulerMode, getSqrtPriceFromPrice, MAX_SQRT_PRICE } from '@meteora-ag/dynamic-bonding-curve-sdk';

dotenv.config();

async function main() {
  // Enable DRY_RUN to skip on-chain submissions and redis writes (validation only)
  const DRY_RUN = process.env.DRY_RUN === 'true';

  // Load treasury keypair from config file
  const treasuryPath = path.resolve(process.cwd(), 'config/keys/treasury.json');
  const treasurySecret = JSON.parse(fs.readFileSync(treasuryPath, 'utf-8'));
  const TREASURY_KP = Keypair.fromSecretKey(Buffer.from(treasurySecret));
  const treasuryPubkey = TREASURY_KP.publicKey;

  console.log('TREASURY_KP', TREASURY_KP.publicKey.toBase58());
  // Initialize Redis client (skipped in DRY_RUN)
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redis = DRY_RUN ? (null as unknown as Redis) : new Redis({ url: redisUrl!, token: redisToken! });

  // Initialize Solana connection and DBC client
  const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const dbcClient = new DynamicBondingCurveClient(connection, 'confirmed');

  // We already defined DRY_RUN at the top of main()

  // Prepare batching arrays
  const allInstructions: TransactionInstruction[] = [];
  const allSigners: Keypair[] = [TREASURY_KP];
  const poolKeys: string[] = [];
  // Collect config info for deferred Redis write
  type ConfigInfo = {
    configKeypair: Keypair;
    pubkey: string;
    label: string;
    description: string;
    config: any;
  };
  const configs: ConfigInfo[] = [];
  const DEFAULT_POOL_SUPPLY = 1_000_000_000;
  const decimals = 9;
  const multiplier = new BN(10).pow(new BN(decimals));
  const poolSupplyRaw = new BN(DEFAULT_POOL_SUPPLY).mul(multiplier);
  console.log('poolSupplyRaw', poolSupplyRaw.toString());


  // Preset bonding curve definitions
  const presets: { label: string; description: string; config: any }[] = [
    {
      label: 'Classic — Balanced fee, no lock, clean curve',
      description: 'A well-rounded setup for most launches. Starts with a 1% fee and smooth linear price curve. No LP is locked, making this perfect for fast launches with clean exit paths.',
      config: {
        collectFeeMode: 0,
        activationType: 1,
        migrationOption: 1,
        tokenType: 1,
        tokenDecimal: 9,
        migrationQuoteThreshold: new BN(1),
        partnerLpPercentage: 5,
        partnerLockedLpPercentage: 0,
        creatorLpPercentage: 95,
        creatorLockedLpPercentage: 0,
        migrationFeeOption: 2,
        migrationFee: { feePercentage: 1, creatorFeePercentage: 0 },
        creatorTradingFeePercentage: 0,
        tokenSupply: null,
        tokenUpdateAuthority: 0,
        padding0: [],
        padding1: [],
        lockedVesting: {
          amountPerPeriod: new BN(0),
          cliffDurationFromMigrationTime: new BN(0),
          frequency: new BN(0),
          numberOfPeriod: new BN(0),
          cliffUnlockAmount: new BN(0),
        },
        poolFees: {
          baseFee: {
            cliffFeeNumerator: bpsToFeeNumerator(100),
            numberOfPeriod: 0,
            periodFrequency: new BN(0),
            reductionFactor: new BN(0),
            feeSchedulerMode: FeeSchedulerMode.Linear,
          },
          dynamicFee: null,
        },
        sqrtStartPrice: getSqrtPriceFromPrice('1', 9, 9),
        curve: [
          { sqrtPrice: MAX_SQRT_PRICE, liquidity: poolSupplyRaw },
        ],
      },
    },
    {
      label: 'Hype — High start, higher fees, faster pump',
      description: 'Designed to pump early. Starts at a higher price with a 2% fee to capture hype and flip volume. Best for meme-driven or influencer-led tokens aiming to run hot out of the gate.',
      config: {
        collectFeeMode: 0,
        activationType: 1,
        migrationOption: 1,
        tokenType: 1,
        tokenDecimal: 9,
        migrationQuoteThreshold: new BN(1),
        partnerLpPercentage: 5,
        partnerLockedLpPercentage: 0,
        creatorLpPercentage: 95,
        creatorLockedLpPercentage: 0,
        migrationFeeOption: 2,
        migrationFee: { feePercentage: 1, creatorFeePercentage: 0 },
        creatorTradingFeePercentage: 0,
        tokenSupply: null,
        tokenUpdateAuthority: 0,
        padding0: [],
        padding1: [],
        lockedVesting: {
          amountPerPeriod: new BN(0),
          cliffDurationFromMigrationTime: new BN(0),
          frequency: new BN(0),
          numberOfPeriod: new BN(0),
          cliffUnlockAmount: new BN(0),
        },
        poolFees: {
          baseFee: {
            cliffFeeNumerator: bpsToFeeNumerator(200),
            numberOfPeriod: 0,
            periodFrequency: new BN(0),
            reductionFactor: new BN(0),
            feeSchedulerMode: FeeSchedulerMode.Linear,
          },
          dynamicFee: null,
        },
        sqrtStartPrice: getSqrtPriceFromPrice('5', 9, 9),
        curve: [
        { sqrtPrice: MAX_SQRT_PRICE, liquidity: poolSupplyRaw },
        ],
      },
    },
    {
      label: 'Slow Ramp — near-zero fee, low start, grow over time',
      description: 'A near-zero-fee (0.01%) low-start bonding curve for long-term growth. Perfect for creators who want users to accumulate early and avoid friction. Steady incline with no rush.',
      config: {
        collectFeeMode: 0,
        activationType: 1,
        migrationOption: 1,
        tokenType: 1,
        tokenDecimal: 9,
        migrationQuoteThreshold: new BN(1),
        partnerLpPercentage: 5,
        partnerLockedLpPercentage: 0,
        creatorLpPercentage: 95,
        creatorLockedLpPercentage: 0,
        migrationFeeOption: 2,
        migrationFee: { feePercentage: 1, creatorFeePercentage: 0 },
        creatorTradingFeePercentage: 0,
        tokenSupply: null,
        tokenUpdateAuthority: 0,
        padding0: [],
        padding1: [],
        lockedVesting: {
          amountPerPeriod: new BN(0),
          cliffDurationFromMigrationTime: new BN(0),
          frequency: new BN(0),
          numberOfPeriod: new BN(0),
          cliffUnlockAmount: new BN(0),
        },
        poolFees: {
          baseFee: {
            cliffFeeNumerator: bpsToFeeNumerator(1),
            numberOfPeriod: 0,
            periodFrequency: new BN(0),     
            reductionFactor: new BN(0),
            feeSchedulerMode: FeeSchedulerMode.Linear,
          },
          dynamicFee: null,
        },
        sqrtStartPrice: getSqrtPriceFromPrice('0.5', 9, 9),
        curve: [
            { sqrtPrice: MAX_SQRT_PRICE, liquidity: poolSupplyRaw },
        ],
      },
    },
    {
      label: 'Trench Lock — Half LP locked, adds trust',
      description: 'Same price behavior as Classic, but with 50% of LP locked to reduce fear of instant exits. Starts with a 1% fee. Great for tokens looking to earn community trust or deploy under a shared brand.',
      config: {
        collectFeeMode: 0,
        activationType: 1,
        migrationOption: 1,
        tokenType: 1,
        tokenDecimal: 9,
        migrationQuoteThreshold: new BN(1),
        
        partnerLpPercentage: 0,
        partnerLockedLpPercentage: 50,
        creatorLpPercentage: 0,
        creatorLockedLpPercentage: 50,

        migrationFeeOption: 2,
        migrationFee: { feePercentage: 1, creatorFeePercentage: 0 },
        creatorTradingFeePercentage: 0,
        tokenSupply: null,
        tokenUpdateAuthority: 0,
        padding0: [],
        padding1: [],
        lockedVesting: {
          amountPerPeriod: new BN(0),
          cliffDurationFromMigrationTime: new BN(0),
          frequency: new BN(0),
          numberOfPeriod: new BN(0),
          cliffUnlockAmount: new BN(0),
        },
        poolFees: {
          baseFee: {
            cliffFeeNumerator: bpsToFeeNumerator(100),
            numberOfPeriod: 0,
            periodFrequency: new BN(0),
            reductionFactor: new BN(0),
            feeSchedulerMode: FeeSchedulerMode.Linear,
          },
          dynamicFee: null,
        },
        sqrtStartPrice: getSqrtPriceFromPrice('1', 9, 9),
        curve: [
          { sqrtPrice: MAX_SQRT_PRICE, liquidity: poolSupplyRaw },
        ],
      },
    },
    {
      label: 'Builder — Fees fall over time, with unlock schedule',
      description: 'Starts with a 2% fee that drops linearly over days. Ideal for tokens with a roadmap. Includes optional token vesting logic and cliff.',
      config: {
        collectFeeMode: 0,
        activationType: 1,
        migrationOption: 1,
        tokenType: 1,
        tokenDecimal: 9,
        migrationQuoteThreshold: new BN(1),
        partnerLpPercentage: 5,
        partnerLockedLpPercentage: 0,
        creatorLpPercentage: 95,
        creatorLockedLpPercentage: 0,
        migrationFeeOption: 2,
        migrationFee: { feePercentage: 1, creatorFeePercentage: 0 },
        creatorTradingFeePercentage: 0,
        tokenSupply: null,
        tokenUpdateAuthority: 0,
        padding0: [],
        padding1: [],
        lockedVesting: {
          amountPerPeriod: new BN(1000000),
          cliffDurationFromMigrationTime: new BN(86400),
          frequency: new BN(86400),
          numberOfPeriod: new BN(10),
          cliffUnlockAmount: new BN(10000000),
        },
        poolFees: {
          baseFee: {
            cliffFeeNumerator: bpsToFeeNumerator(200),
            numberOfPeriod: 5,
            periodFrequency: new BN(86400),
            reductionFactor: new BN(25),
            feeSchedulerMode: FeeSchedulerMode.Linear,
          },
          dynamicFee: null,
        },
        sqrtStartPrice: getSqrtPriceFromPrice('1', 9, 9),
        curve: [
          { sqrtPrice: MAX_SQRT_PRICE, liquidity: poolSupplyRaw },
        ],
      },
    },
  ];

  for (const preset of presets) {
    console.log(`Processing preset: ${preset.label}`);
    // Generate config keypair
    const configKeypair = Keypair.generate();
    const configPubkey = configKeypair.publicKey;
    console.log('configPubkey', configPubkey.toBase58());

    // Build createConfig transaction instructions and collect for batching
    const txV0 = await dbcClient.partner.createConfig({
      payer: treasuryPubkey,
      config: configPubkey,
      feeClaimer: treasuryPubkey,
      leftoverReceiver: treasuryPubkey,
      quoteMint: NATIVE_MINT,
      ...preset.config
    });

    allInstructions.push(...txV0.instructions);
    allSigners.push(configKeypair);
    poolKeys.push(configPubkey.toBase58());

    // Defer Redis writes until after successful batch send
    configs.push({
      configKeypair,
      pubkey: configPubkey.toBase58(),
      label: preset.label,
      description: preset.description,
      config: preset.config,
    });
  }
  
  console.log('pool keys');
  console.log(poolKeys.join('\n===========================================\n'))

  if (DRY_RUN) {
    console.log('\u26A0\uFE0F  DRY_RUN mode enabled – skipping on-chain transaction submission and Redis writes.');
    console.log(`Built ${allInstructions.length} instructions across ${presets.length} configs – validation successful.`);
    return;
  }

  // Build and send a single batched transaction
  console.log('Sending batched transaction for all config creations');

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const message = new TransactionMessage({
    payerKey: treasuryPubkey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message();
  const batchTx = new VersionedTransaction(message);
  batchTx.sign(allSigners);
  const batchTxSig = await connection.sendTransaction(batchTx);
  await connection.confirmTransaction(batchTxSig, 'finalized');
  console.log('Batch transaction signature:', batchTxSig);

  // Persist all Redis data after successful transaction
  for (const { configKeypair, pubkey, label, description, config } of configs) {
    // Persist signer secret
    const signerKey = `dbc:signer:${treasuryPubkey.toBase58()}:${pubkey}`;
    await redis.set(signerKey, Buffer.from(configKeypair.secretKey).toString('base64'));
    // Add to sorted set of config keys
    await redis.zadd('dbc:config:keys', { score: Date.now(), member: pubkey });
    // Store full config definition with txSig
    const poolKey = `dbc:config:${pubkey}`;
    await redis.hset(poolKey, {
      label,
      description,
      config: JSON.stringify(config),
      pubkey,
      txSig: batchTxSig,
    });
  }
  // Trim sorted set to latest 500
  await redis.zremrangebyrank('dbc:config:keys', 0, -10);

  console.log('All presets processed and transaction confirmed');
}

main().catch(err => {
  console.error('Error processing presets', err);
  process.exit(1);
});
