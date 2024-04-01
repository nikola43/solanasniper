import { BigNumberish, LIQUIDITY_STATE_LAYOUT_V4, Liquidity, Token } from "@raydium-io/raydium-sdk";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { PublicKey, TransactionMessage, ComputeBudgetProgram, VersionedTransaction, Connection, Keypair } from "@solana/web3.js";
import { logger } from "./utils";
import {
  AUTO_SELL,
  AUTO_SELL_DELAY,
  CHECK_IF_MINT_IS_RENOUNCED,
  COMMITMENT_LEVEL,
  LOG_LEVEL,
  MAX_SELL_RETRIES,
  NETWORK,
  PRIVATE_KEY,
  QUOTE_AMOUNT,
  QUOTE_MINT,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  SNIPE_LIST_REFRESH_INTERVAL,
  USE_SNIPE_LIST,
  MIN_POOL_SIZE,
} from './constants';
import bs58 from "bs58";
import { getRaydiumPoolKey, getTokenAccounts } from "./liquidity";
import { MinimalTokenAccountData } from "./NewPairListener";

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

let wallet: Keypair;
wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
logger.info(`Wallet Address: ${wallet.publicKey}`);
let    quoteToken = Token.WSOL;
let quoteTokenAssociatedAddress: PublicKey;
const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();



async function sell(poolId: PublicKey, mint: PublicKey, amount: BigNumberish): Promise<void> {

  const tokenAccounts = await getTokenAccounts(connection, wallet.publicKey, COMMITMENT_LEVEL);
  const tokenAccount = tokenAccounts.find((acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString())!;
  for (const ta of tokenAccounts) {
    existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
      mint: ta.accountInfo.mint,
      address: ta.pubkey,
    });
  }

  if (!tokenAccount) {
    throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
  }

  quoteTokenAssociatedAddress = tokenAccount.pubkey;

  const accountInfo = await await connection.getAccountInfo(poolId, COMMITMENT_LEVEL);

  const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo!.data);

  const poolInfo = await getRaydiumPoolKey(poolState, connection);



  let sold = false;
  let retries = 0;

  // if (AUTO_SELL_DELAY > 0) {
  //   await new Promise((resolve) => setTimeout(resolve, AUTO_SELL_DELAY));
  // }

  do {
    try {
      const tokenAccount = existingTokenAccounts.get(mint.toString());

      if (!tokenAccount) {
        return;
      }

      tokenAccount.poolKeys = poolInfo;

      if (!tokenAccount.poolKeys) {
        logger.warn({ mint }, 'No pool keys found');
        return;
      }

      if (amount === 0) {
        logger.info(
          {
            mint: tokenAccount.mint,
          },
          `Empty balance, can't sell`,
        );
        return;
      }

      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: tokenAccount.poolKeys!,
          userKeys: {
            tokenAccountOut: quoteTokenAssociatedAddress,
            tokenAccountIn: tokenAccount.address,
            owner: wallet.publicKey,
          },
          amountIn: amount,
          minAmountOut: 0,
        },
        tokenAccount.poolKeys!.version,
      );

      const latestBlockhash = await connection.getLatestBlockhash({
        commitment: COMMITMENT_LEVEL,
      });
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 421197 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 101337 }),
          ...innerTransaction.instructions,
          createCloseAccountInstruction(tokenAccount.address, wallet.publicKey, wallet.publicKey),
        ],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: COMMITMENT_LEVEL,
      });
      logger.info({ mint, signature }, `Sent sell tx`);
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        COMMITMENT_LEVEL,
      );
      if (confirmation.value.err) {
        logger.debug(confirmation.value.err);
        logger.info({ mint, signature }, `Error confirming sell tx`);
        continue;
      }

      logger.info(
        {
          dex: `https://dexscreener.com/solana/${mint}?maker=${wallet.publicKey}`,
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
        },
        `Confirmed sell tx`,
      );
      sold = true;
    } catch (e: any) {
      // wait for a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries++;
      logger.debug(e);
      logger.error({ mint }, `Failed to sell token, retry: ${retries}/${MAX_SELL_RETRIES}`);
    }
  } while (!sold && retries < MAX_SELL_RETRIES);
}



const poolId = new PublicKey("Br4xQjoEN1kkPjzg587v3wWgVdTgqazYuTXFUpadY2iP")
const mint = new PublicKey("aDA2DFisZkevkjE3v1w5AEcAyzBH7gesjTykE2BwU2G")
const amount = 270
sell(poolId, mint, amount)