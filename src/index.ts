import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor.default;
import { clusterApiUrl, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import os from "os";

import MatoIDL from "./idl/mato.json" with { type: "json" };
import type { Mato } from "./types/mato.ts";

process.env.ANCHOR_PROVIDER_URL = clusterApiUrl("devnet");
process.env.ANCHOR_WALLET = os.homedir() + "/.config/solana/id.json";

const exits = new PublicKey("D467xRNpNHvxbG7nRApDSshnvqVDhL4YjBYqz9TsoKF9");
const prices = new PublicKey("Dpe9rm2NFSTowGbvrwXccbW7FtGfrQCdu6ogugNW6akK");

let solMint = NATIVE_MINT;
let usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

(async () => {
  const provider = anchor.AnchorProvider.env();
  const program = new anchor.Program(MatoIDL as Mato, provider);

  const duration = 2000;


  while (true) {

    let usdcATA = getAssociatedTokenAddressSync(
      usdcMint,
      provider.publicKey
    );

    let solATA = getAssociatedTokenAddressSync(
      solMint,
      provider.publicKey
    );

    let solBalance = await provider.connection.getBalance(provider.publicKey);


    let depositTx = new Transaction();
    try {
      let accountInfo = await provider.connection.getAccountInfo(solATA);
      if (accountInfo == null) {
        depositTx.add(
          createAssociatedTokenAccountInstruction(
          provider.publicKey,
          solATA,
          provider.publicKey,
          solMint
          )
        );
      }

      if (solBalance > 20 * LAMPORTS_PER_SOL) {
      depositTx.add(
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: solATA,
          lamports: solBalance - 20 * LAMPORTS_PER_SOL,
        }),
        createSyncNativeInstruction(solATA)
      );
    }

    if (depositTx.instructions.length > 0) {
      await provider.sendAndConfirm(depositTx);
    }

    } catch (e) {
      console.log(e)
    }


    let wrappedSolBalance = 0;
    try {
      let solTokenAmount = await provider.connection.getTokenAccountBalance(solATA);
      wrappedSolBalance += parseInt(solTokenAmount.value.amount);
    } catch (e) {
      console.log("Failed to get Sol balance", e);
    }

    let usdcBalance = 0;
    try {
      let usdcTokenAmount = await provider.connection.getTokenAccountBalance(usdcATA);
      usdcBalance += parseInt(usdcTokenAmount.value.amount);
    } catch (e) {
      console.log("Failed to get USDC balance", e);
    }

    if (usdcBalance >= 2000000000 && wrappedSolBalance >= 10 * LAMPORTS_PER_SOL) {
    try {
        await program.methods
          .depositTokenA(new BN(Date.now()), new BN(wrappedSolBalance - 1), new BN(duration))
          .accounts({
            depositor: provider.publicKey,
            tokenMintA: solMint,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await program.methods
          .depositTokenB(new BN(Date.now()), new BN(usdcBalance - 1), new BN(duration))
          .accounts({
            depositor: provider.publicKey,
            tokenMintB: usdcMint,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc()


    } catch (e) {
      console.log("Error providing liquidity", e);
    }
  }

    await new Promise((f) => setTimeout(f, 2 * 60 * 1000));
  }

})()
  .then(() => console.log("Liquidity provided!"))
  .catch((e) => console.log(e));