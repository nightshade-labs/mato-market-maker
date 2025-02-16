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
process.env.ANCHOR_WALLET = os.homedir() + "/.config/solana/mato.json";

const exits = new PublicKey("D467xRNpNHvxbG7nRApDSshnvqVDhL4YjBYqz9TsoKF9");
const prices = new PublicKey("Dpe9rm2NFSTowGbvrwXccbW7FtGfrQCdu6ogugNW6akK");

let solMint = NATIVE_MINT;
let usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

(async () => {
  const provider = anchor.AnchorProvider.env();
  const program = new anchor.Program(MatoIDL as Mato, provider);

  const duration = 2000;

  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), exits.toBuffer(), prices.toBuffer()],
    program.programId
  );


  while (true) {
    let currentSlot;
    let allPositionsA;
    let allPositionsB;

    try {
      currentSlot = await provider.connection.getSlot();
      allPositionsA = await program.account.positionA.all([
        {
          memcmp: {
            offset: 8, // discriminator
            bytes: provider.publicKey.toBase58(),
          },
        },
      ]);
      allPositionsB = await program.account.positionB.all([
        {
          memcmp: {
            offset: 8, // discriminator
            bytes: provider.publicKey.toBase58(),
          },
        },
      ]);
    } catch(e) {
      continue;
    }

    allPositionsA.forEach(async (position) => {
        if (currentSlot - position.account.startSlot > duration / 4) {
        const [positionAPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position_a"),
            market.toBuffer(),
            position.account.owner.toBuffer(),
            position.account.id.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        let usdcATA = getAssociatedTokenAddressSync(
          usdcMint,
          position.account.owner
        );

      try{
        await program.methods
          .withdrawSwappedTokenB()
          .accountsPartial({
            withdrawer: provider.publicKey,
            withdrawerTokenAccount: usdcATA,
            tokenMintB: usdcMint,
            market: market,
            positionA: positionAPda,
            // bookkeeping: bookkeeping,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ skipPreflight: true });

          await new Promise((f) => setTimeout(f, 1000));
        } catch (e) {
          console.log("Error withdrawing tokens b:", e);
        }
      }

    });

    allPositionsB.forEach(async (position) => {
      if (currentSlot - position.account.startSlot > duration / 4) {
        const [positionBPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position_b"),
            market.toBuffer(),
            position.account.owner.toBuffer(),
            position.account.id.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        let solATA = getAssociatedTokenAddressSync(
          solMint,
          position.account.owner
        );

        try {
        await program.methods
          .withdrawSwappedTokenA()
          .accountsPartial({
            withdrawer: provider.publicKey,
            withdrawerTokenAccount: solATA,
            tokenMintA: solMint,
            // market: market,
            positionB: positionBPda,
            // bookkeeping: bookkeeping,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ skipPreflight: true });

          await new Promise((f) => setTimeout(f, 1000));
        } catch (e) {
          console.log("Error withdrawing tokens a:", e);
        }
      }

    });


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

    if (usdcBalance >= 200000000 && wrappedSolBalance >= 1 * LAMPORTS_PER_SOL) {
    try {
        let swapTx = new Transaction();
        let swapA = await program.methods
          .depositTokenA(new BN(Date.now()), new BN(wrappedSolBalance - 10 * LAMPORTS_PER_SOL), new BN(duration))
          .accounts({
            depositor: provider.publicKey,
            tokenMintA: solMint,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();

        let swapB = await program.methods
          .depositTokenB(new BN(Date.now()), new BN(usdcBalance - 1), new BN(duration))
          .accounts({
            depositor: provider.publicKey,
            tokenMintB: usdcMint,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();

          swapTx.add(swapA, swapB);

          await provider.sendAndConfirm(swapTx, [], {skipPreflight: true});


    } catch (e) {
      console.log("Error providing liquidity", e);
    }
  }

    await new Promise((f) => setTimeout(f, 2 * 60 * 1000));
  }

})()
  .then(() => console.log("Liquidity provided!"))
  .catch((e) => console.log(e));