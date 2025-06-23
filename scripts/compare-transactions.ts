#!/usr/bin/env ts-node-esm
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Compare transaction analysis from test harness and frontend
 * Usage: Copy the JSON output from create-pool.tsx console and save it as frontend-analysis.json
 * Then run: npm run compare-transactions
 */

function compareTransactions() {
  // Read test harness debug file
  const testHarnessPath = path.resolve(__dirname, '../logs/create-token-debug.json');
  const frontendPath = path.resolve(__dirname, '../logs/frontend-analysis.json');
  
  if (!fs.existsSync(testHarnessPath)) {
    console.error('Test harness debug file not found. Run: npm run test:create-token');
    process.exit(1);
  }
  
  if (!fs.existsSync(frontendPath)) {
    console.error(`Frontend analysis file not found at ${frontendPath}`);
    console.error('Copy the JSON from browser console (between === markers) and save it there.');
    process.exit(1);
  }
  
  const testData = JSON.parse(fs.readFileSync(testHarnessPath, 'utf8'));
  const frontendData = JSON.parse(fs.readFileSync(frontendPath, 'utf8'));
  
  const testAnalysis = testData.transactionAnalysis;
  const frontendAnalysis = frontendData;
  
  console.log('=== TRANSACTION COMPARISON ===\n');
  
  // Compare basic info
  console.log('Test Harness Wallet:', testAnalysis.walletInfo.publicKey);
  console.log('Frontend Wallet:', frontendAnalysis.walletInfo.publicKey);
  console.log('');
  
  // Compare each transaction
  for (let i = 0; i < 2; i++) {
    console.log(`\n--- Transaction ${i} ---`);
    
    const testTx = testAnalysis.transactions[i];
    const frontendTx = frontendAnalysis.transactions[i];
    
    // Compare headers
    console.log('\nHeaders:');
    console.log('Test:', JSON.stringify(testTx.header));
    console.log('Frontend:', JSON.stringify(frontendTx.header));
    console.log('Match:', JSON.stringify(testTx.header) === JSON.stringify(frontendTx.header) ? '✅' : '❌');
    
    // Compare blockhash
    console.log('\nBlockhash:');
    console.log('Test:', testTx.recentBlockhash);
    console.log('Frontend:', frontendTx.recentBlockhash);
    console.log('Match:', testTx.recentBlockhash === frontendTx.recentBlockhash ? '✅' : '❌');
    
    // Compare account keys
    console.log('\nAccount Keys:');
    const testKeys = testTx.staticAccountKeys;
    const frontendKeys = frontendTx.staticAccountKeys;
    
    if (testKeys.length !== frontendKeys.length) {
      console.log(`❌ Different number of accounts: ${testKeys.length} vs ${frontendKeys.length}`);
    }
    
    for (let j = 0; j < Math.max(testKeys.length, frontendKeys.length); j++) {
      const match = testKeys[j] === frontendKeys[j];
      console.log(`  [${j}] ${match ? '✅' : '❌'} Test: ${testKeys[j] || 'MISSING'}`);
      if (!match) {
        console.log(`       Frontend: ${frontendKeys[j] || 'MISSING'}`);
      }
    }
    
    // Compare instructions
    console.log('\nInstructions:');
    console.log('Test count:', testTx.compiledInstructions.length);
    console.log('Frontend count:', frontendTx.compiledInstructions.length);
    
    for (let j = 0; j < Math.max(testTx.compiledInstructions.length, frontendTx.compiledInstructions.length); j++) {
      const testInst = testTx.compiledInstructions[j];
      const frontendInst = frontendTx.compiledInstructions[j];
      
      if (!testInst || !frontendInst) {
        console.log(`  Instruction ${j}: ❌ Missing in ${!testInst ? 'test' : 'frontend'}`);
        continue;
      }
      
      const dataMatch = testInst.dataHex === frontendInst.dataHex;
      console.log(`  Instruction ${j}: ${dataMatch ? '✅' : '❌'}`);
      if (!dataMatch) {
        console.log(`    Test data: ${testInst.dataHex}`);
        console.log(`    Frontend data: ${frontendInst.dataHex}`);
      }
    }
    
    // Compare signatures
    console.log('\nSignatures:');
    console.log('Before signing:');
    const testSigsBefore = testTx.signatures.beforeClientSign;
    const frontendSigsBefore = frontendTx.signatures.beforeClientSign;
    
    for (let j = 0; j < Math.max(testSigsBefore.length, frontendSigsBefore.length); j++) {
      const testSig = testSigsBefore[j];
      const frontendSig = frontendSigsBefore[j];
      console.log(`  [${j}] Test: ${testSig?.present ? 'present' : 'empty'}, Frontend: ${frontendSig?.present ? 'present' : 'empty'}`);
    }
    
    console.log('\nAfter client signing:');
    const testSigsAfter = testTx.signatures.afterClientSign;
    const frontendSigsAfter = frontendTx.signatures.afterClientSign;
    
    for (let j = 0; j < Math.max(testSigsAfter.length, frontendSigsAfter.length); j++) {
      const testSig = testSigsAfter[j];
      const frontendSig = frontendSigsAfter[j];
      console.log(`  [${j}] Test: ${testSig?.present ? 'present' : 'empty'}, Frontend: ${frontendSig?.present ? 'present' : 'empty'}`);
    }
    
    // Compare base64 transactions
    console.log('\nBase64 Transaction Match:');
    console.log('Original:', testTx.base64.original === frontendTx.base64.original ? '✅' : '❌');
    console.log('After client sign:', testTx.base64.afterClientSign === frontendTx.base64.afterClientSign ? '✅' : '❌');
    
    if (testTx.base64.original !== frontendTx.base64.original) {
      console.log('\n⚠️  Original transactions differ! This is the root cause.');
      console.log('Test base64:', testTx.base64.original.substring(0, 50) + '...');
      console.log('Frontend base64:', frontendTx.base64.original.substring(0, 50) + '...');
    }
  }
  
  // Compare request payloads
  console.log('\n\n--- Request Payload Comparison ---');
  console.log('Test payload:', JSON.stringify(testAnalysis.requestPayload, null, 2));
  console.log('\nFrontend payload:', JSON.stringify(frontendAnalysis.requestPayload, null, 2));
  
  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log('Key differences to investigate:');
  console.log('1. Check if original base64 transactions match');
  console.log('2. Compare account keys order');
  console.log('3. Verify instruction data');
  console.log('4. Check wallet public keys match');
}

compareTransactions(); 