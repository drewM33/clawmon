/**
 * Trusted ClawMon — Monad Setup Script
 *
 * Deploys the MessageLog contract to Monad and displays the contract address.
 *
 * Run: npm run setup
 *
 * Prerequisites:
 *   - Copy .env.example to .env
 *   - Fill in MONAD_PRIVATE_KEY with a funded Monad testnet wallet
 *   - Fill in MONAD_RPC_URL (defaults to https://testnet.monad.xyz/v1)
 *
 * After running, copy the output contract address into your .env file.
 */

import 'dotenv/config';
import { ethers } from 'ethers';

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('   Trusted ClawMon — Monad Setup');
  console.log('══════════════════════════════════════════════');
  console.log();

  const rpcUrl = process.env.MONAD_RPC_URL || 'https://testnet.monad.xyz/v1';
  const privateKey = process.env.MONAD_PRIVATE_KEY;

  if (!privateKey) {
    console.error('Missing MONAD_PRIVATE_KEY environment variable.');
    console.error('Add your Monad testnet private key to .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`  RPC:     ${rpcUrl}`);
  console.log(`  Wallet:  ${wallet.address}`);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance: ${ethers.formatEther(balance)} MON`);

  if (balance === 0n) {
    console.error('\n  Wallet has no MON. Fund it from the Monad testnet faucet first.');
    process.exit(1);
  }

  // Check if MessageLog contract is already configured
  const existingAddress = process.env.MESSAGELOG_CONTRACT_ADDRESS;
  if (existingAddress) {
    console.log(`\n  Existing MessageLog contract found: ${existingAddress}`);
    try {
      const code = await provider.getCode(existingAddress);
      if (code !== '0x' && code.length > 2) {
        console.log('  Contract verified on-chain.');
        console.log('  To deploy a new one, remove MESSAGELOG_CONTRACT_ADDRESS from .env first.\n');
        return;
      }
    } catch {
      // Ignore
    }
    console.log('  Contract not found on-chain. Deploying a new one...\n');
  }

  // Read the compiled artifact
  let artifact;
  try {
    artifact = await import('../artifacts/contracts/MessageLog.sol/MessageLog.json', {
      assert: { type: 'json' },
    });
  } catch {
    console.error('  MessageLog artifact not found. Run `npm run compile:contracts` first.');
    process.exit(1);
  }

  console.log('\n  Deploying MessageLog contract...');
  const factory = new ethers.ContractFactory(
    artifact.default.abi,
    artifact.default.bytecode,
    wallet,
  );

  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`  MessageLog deployed: ${address}`);

  console.log('\n' + '='.repeat(50));
  console.log('Add this to your .env file:\n');
  console.log(`MESSAGELOG_CONTRACT_ADDRESS=${address}`);
  console.log('\n' + '='.repeat(50));
  console.log('\nDone! Run `npm run seed` next to populate with test data.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
