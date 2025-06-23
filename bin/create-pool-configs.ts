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
import Decimal from 'decimal.js';
import {
  DynamicBondingCurveClient,
  buildCurveWithLiquidityWeights,
  ActivationType,
  CollectFeeMode,
  MigrationOption,
  MigrationFeeOption,
  TokenType,
  TokenDecimal,
  TokenUpdateAuthorityOption,
  BaseFeeMode,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

dotenv.config();

async function main() {
  const DRY_RUN = process.env.DRY_RUN === 'true';

  // Treasury keypair
  const keyPath = path.resolve(process.cwd(), 'config/keys/creator.json');
  const secret = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const TREASURY_KP = Keypair.fromSecretKey(Buffer.from(secret));
  const treasury = TREASURY_KP.publicKey;
  console.log('TREASURY_KP', treasury.toBase58());

  // Redis client
  const redis = DRY_RUN
    ? (null as unknown as Redis)
    : new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });

  // Solana connection and DBC client
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const dbc = new DynamicBondingCurveClient(connection, 'confirmed');

  // Base supply in raw units (lamports if decimals=9)
  const DEFAULT_POOL_SUPPLY = 1_000_000_000;
  const decimals = 9;
  const poolSupplyRaw = new BN(DEFAULT_POOL_SUPPLY).mul(new BN(10).pow(new BN(decimals)));
  
  // Shared BuildCurve parameters
  const shared = {
    totalTokenSupply: 1_000_000_000,
    migrationOption: MigrationOption.MET_DAMM_V2,
    tokenBaseDecimal: TokenDecimal.NINE,
    tokenQuoteDecimal: TokenDecimal.NINE,
    lockedVestingParam: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
    },
    dynamicFeeEnabled: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: CollectFeeMode.OnlyQuote,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    tokenType: TokenType.Token2022,
    partnerLockedLpPercentage: 0,
    creatorLockedLpPercentage: 0,
    creatorTradingFeePercentage: 0,
    leftover: poolSupplyRaw,
    tokenUpdateAuthority: TokenUpdateAuthorityOption.Mutable,
    migrationFee: { feePercentage: 25, creatorFeePercentage: 50 },
  } as const;

  // 16-segment weight generators
  const flat = () => Array(16).fill(1);
  const up = () => Array.from({ length: 16 }, (_, i) => new Decimal(1.5).pow(i).toNumber());
  const down = () => Array.from({ length: 16 }, (_, i) => new Decimal(1.5).pow(15 - i).toNumber());
  const mild = () => Array.from({ length: 16 }, (_, i) => new Decimal(1.15).pow(i).toNumber());

  // Preset definitions: key, label, description, weights & caps
  type Preset = { key: string; label: string; description: string; weights: () => number[]; initial: number; migration: number; partnerLp: number; creatorLp: number; migrationFeeOpt?: MigrationFeeOption };
  const presets: Preset[] = [
    { key: 'classic',   label: 'Classic — Balanced fee, no lock', weights: flat, initial: 5_000,   migration: 1_000_000, partnerLp: 5,  creatorLp: 95 },
    { key: 'hype',      label: 'Hype — High start, faster pump',  weights: up,   initial: 50_000,  migration: 5_000_000, partnerLp: 0,  creatorLp: 100, migrationFeeOpt: MigrationFeeOption.FixedBps200 },
    { key: 'slow-ramp', label: 'Slow Ramp — low start, slow grow', weights: down, initial: 1_000,   migration: 1_000_000, partnerLp: 10, creatorLp: 90 },
    { key: 'builder',   label: 'Builder — mild exponential',      weights: mild, initial: 2_500,   migration: 1_000_000, partnerLp: 10, creatorLp: 90 },
  ];

  // Collect transaction metadata
  type TxMeta = { instructions: TransactionInstruction[]; signers: Keypair[]; pubkey: string; label: string; description: string; };
  const metas: TxMeta[] = [];

  for (const p of presets) {
    console.log(`Building preset: ${p.key}`);
    const cfg = await buildCurveWithLiquidityWeights({
      ...shared,
      initialMarketCap: p.initial,
      migrationMarketCap: p.migration,
      partnerLpPercentage: p.partnerLp,
      creatorLpPercentage: p.creatorLp,
      ...(p.migrationFeeOpt !== undefined ? { migrationFeeOption: p.migrationFeeOpt } : {}),
      liquidityWeights: p.weights(),
    });

    const keypair = Keypair.generate();
    const addr = keypair.publicKey;
    console.log('Config:', p.key, addr.toBase58());

    const tx = await dbc.partner.createConfig({ payer: treasury, config: addr, feeClaimer: treasury, leftoverReceiver: treasury, quoteMint: NATIVE_MINT, ...cfg });

    metas.push({ instructions: tx.instructions, signers: [TREASURY_KP, keypair], pubkey: addr.toBase58(), label: p.label, description: p.description });
  }

  console.log('Prepared', metas.length, 'configs');
  if (DRY_RUN) {
    console.log('DRY_RUN: no on-chain submission or Redis writes');
    return;
  }

  // Send transactions and store in Redis
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const message = new TransactionMessage({ payerKey: treasury, recentBlockhash: blockhash, instructions: m.instructions }).compileToV0Message();
    const txv = new VersionedTransaction(message);
    txv.sign(m.signers);
    const sig = await connection.sendTransaction(txv);
    await connection.confirmTransaction(sig, 'finalized');
    console.log(`Sent [${i + 1}/${metas.length}] sig=`, sig);

    // Redis persistence
    const signerKey = `dbc:signer:${treasury.toBase58()}:${m.pubkey}`;
    const kp = m.signers.find(s => s.publicKey.toBase58() === m.pubkey && s !== TREASURY_KP)!;
    await redis.set(signerKey, Buffer.from(kp.secretKey).toString('base64'));
    await redis.zadd('dbc:config:keys', { score: Date.now(), member: m.pubkey });
    await redis.hset(`dbc:config:${m.pubkey}`, { label: m.label, description: m.description, pubkey: m.pubkey, txSig: sig });
  }
  console.log('All done');
}

main().catch(e => { console.error(e); process.exit(1); });