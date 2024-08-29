import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet as AnchorWallet } from "@coral-xyz/anchor";
import { Orcacpi } from "../target/types/orcacpi";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Connection } from "@solana/web3.js";

import {
  ORCA_WHIRLPOOL_PROGRAM_ID, 
  ORCA_WHIRLPOOLS_CONFIG,
  PDAUtil,
  SwapUtils,
  swapQuoteByInputToken, 
  WhirlpoolContext, 
  buildWhirlpoolClient,
  IGNORE_CACHE
} from "@orca-so/whirlpools-sdk";

import { TOKEN_PROGRAM_ID, AccountLayout} from "@solana/spl-token";
import { TransactionBuilder, resolveOrCreateATA, DecimalUtil, Percentage, Wallet, TransactionBuilderOptions } from "@orca-so/common-sdk";
import { assert, expect } from "chai";

const SOL = {mint: new PublicKey("So11111111111111111111111111111111111111112"), decimals: 9};
const SAMO = {mint: new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), decimals: 9};
const USDC = {mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6};

const TEST_WALLET_SECRET = [171,47,220,229,16,25,41,67,249,72,87,200,99,166,155,51,227,166,151,173,73,247,62,43,121,185,218,247,54,154,12,174,176,136,16,247,145,71,131,112,92,104,49,155,204,211,96,225,184,95,61,41,136,83,9,18,137,122,214,38,247,37,158,162];

describe("orcacpi", () => {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const testWallet = Keypair.fromSecretKey(new Uint8Array(TEST_WALLET_SECRET));
  
  const provider = new AnchorProvider(connection, new AnchorWallet(testWallet), {commitment: "confirmed"});
  const wallet = provider.wallet as Wallet;
  anchor.setProvider(anchor.AnchorProvider.env());

  const whirlpool_ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const fetcher = whirlpool_ctx.fetcher;
  const whirlpool_client = buildWhirlpoolClient(whirlpool_ctx);
  const transaction_builder_opts: TransactionBuilderOptions = {
    defaultBuildOption: { maxSupportedTransactionVersion: "legacy", blockhashCommitment: "confirmed" },
    defaultConfirmationCommitment: "processed",
    defaultSendOption: {
      skipPreflight: true,
    },
  };
  const program = anchor.workspace.Orcacpi as Program<Orcacpi>;

  const rent_ta = async () => { return connection.getMinimumBalanceForRentExemption(AccountLayout.span) }  
  
  it("Swap!", async () => {
    const sol_usdc_whirlpool_pubkey = PDAUtil.getWhirlpool(ORCA_WHIRLPOOL_PROGRAM_ID, ORCA_WHIRLPOOLS_CONFIG, SOL.mint, USDC.mint, 64).publicKey;
    const sol_usdc_whirlpool_oracle_pubkey = PDAUtil.getOracle(ORCA_WHIRLPOOL_PROGRAM_ID, sol_usdc_whirlpool_pubkey).publicKey;
    const sol_usdc_whirlpool = await fetcher.getPool(sol_usdc_whirlpool_pubkey);

    const sol_input = DecimalUtil.toBN(DecimalUtil.fromNumber(1000 /* SOL */), SOL.decimals);
    const wsol_ta = await resolveOrCreateATA(connection, wallet.publicKey, SOL.mint, rent_ta, sol_input);
    const usdc_ta = await resolveOrCreateATA(connection, wallet.publicKey, USDC.mint, rent_ta);

    const amount = new anchor.BN(sol_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;
    const a_to_b = true;
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);

    const tickarrays = SwapUtils.getTickArrayPublicKeys(
      sol_usdc_whirlpool.tickCurrentIndex,
      sol_usdc_whirlpool.tickSpacing,
      a_to_b,
      ORCA_WHIRLPOOL_PROGRAM_ID,
      sol_usdc_whirlpool_pubkey
    );

    const swap = await program.methods
      .proxySwap(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        whirlpoolProgram: ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpool: sol_usdc_whirlpool_pubkey,
        tokenAuthority: wallet.publicKey,
        tokenVaultA: sol_usdc_whirlpool.tokenVaultA,
        tokenVaultB: sol_usdc_whirlpool.tokenVaultB,
        tokenOwnerAccountA: wsol_ta.address,
        tokenOwnerAccountB: usdc_ta.address,
        tickArray0: tickarrays[0],
        tickArray1: tickarrays[1],
        tickArray2: tickarrays[2],
        oracle: sol_usdc_whirlpool_oracle_pubkey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const transaction = new TransactionBuilder(connection, wallet, transaction_builder_opts)
      .addInstruction(wsol_ta)
      .addInstruction(usdc_ta)
      .addInstruction({instructions: [swap], cleanupInstructions: [], signers: []});

    // verification
    const quote = await swapQuoteByInputToken(
      await whirlpool_client.getPool(sol_usdc_whirlpool_pubkey, IGNORE_CACHE),
      SOL.mint,
      sol_input,
      Percentage.fromFraction(0, 1000),
      ORCA_WHIRLPOOL_PROGRAM_ID,
      fetcher,
      IGNORE_CACHE
    );

    const pre_usdc_ta = await fetcher.getTokenInfo(usdc_ta.address, IGNORE_CACHE);
    const pre_usdc = pre_usdc_ta === null ? new anchor.BN(0) : pre_usdc_ta.amount;

    const signature = await transaction.buildAndExecute();
    await connection.confirmTransaction(signature);

    const post_usdc_ta = await fetcher.getTokenInfo(usdc_ta.address, IGNORE_CACHE);
    const post_usdc = post_usdc_ta.amount;

    const usdc_output = new anchor.BN(post_usdc.toString()).sub(new anchor.BN(pre_usdc.toString()));
    assert(usdc_output.eq(quote.estimatedAmountOut));
  });
});
