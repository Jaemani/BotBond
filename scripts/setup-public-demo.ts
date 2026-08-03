import { readFileSync } from "node:fs";
import { createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection, Keypair } from "@solana/web3.js";

const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const walletPath = process.env.ANCHOR_WALLET ?? ".secrets/botbond-devnet.json";
const walletBytes = JSON.parse(readFileSync(walletPath, "utf8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(walletBytes));
const merchant = Keypair.generate().publicKey;
const connection = new Connection(rpcUrl, "confirmed");
const mint = await createMint(connection, payer, payer.publicKey, null, 6);
await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
await getOrCreateAssociatedTokenAccount(connection, payer, mint, merchant);

console.log(JSON.stringify({
  network: "solana-devnet",
  mint: mint.toBase58(),
  mintAuthority: payer.publicKey.toBase58(),
  merchant: merchant.toBase58(),
}, null, 2));
