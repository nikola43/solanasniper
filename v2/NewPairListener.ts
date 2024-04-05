import {
  BigNumberish,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  LiquidityStateV4,
  MARKET_STATE_LAYOUT_V3,
  MarketStateV3,
  Token,
  TokenAmount,
  MAINNET_PROGRAM_ID,
  Percent,
  LiquidityPoolInfo,
  WSOL,
  LiquidityPoolKeysV4,
  SPL_MINT_LAYOUT,
  Market,
  jsonInfo2PoolKeys
} from '@raydium-io/raydium-sdk';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  createWrappedNativeAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Keypair,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  KeyedAccountInfo,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getTokenAccounts, RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, OPENBOOK_PROGRAM_ID, createPoolKeys } from './liquidity';
import { logger } from './utils';
import { getMinimalMarketV3, MinimalMarketLayoutV3 } from './market';
import { MintLayout } from './types';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
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
import RaydiumSwap from './RaydiumSwap';
import { BN } from '@coral-xyz/anchor';


const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

export interface MinimalTokenAccountData {
  mint: PublicKey;
  address: PublicKey;
  poolKeys?: LiquidityPoolKeys;
  market?: MinimalMarketLayoutV3;
}

const existingLiquidityPools: Set<string> = new Set<string>();
const existingOpenBookMarkets: Set<string> = new Set<string>();
const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
let quoteMinPoolSizeAmount: TokenAmount;
let raydiumSwap: RaydiumSwap;

let snipeList: string[] = [];

async function init(): Promise<void> {
  logger.level = LOG_LEVEL;


  // get wallet
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // get quote mint and amount
  switch (QUOTE_MINT) {
    case 'WSOL': {
      quoteToken = Token.WSOL;
      quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      break;
    }
    case 'USDC': {
      quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
      quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      break;
    }
    default: {
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
    }
  }

  logger.info(`Snipe list: ${USE_SNIPE_LIST}`);
  logger.info(`Check mint renounced: ${CHECK_IF_MINT_IS_RENOUNCED}`);
  logger.info(
    `Min pool size: ${quoteMinPoolSizeAmount.isZero() ? 'false' : quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
  );
  logger.info(`Buy amount: ${quoteAmount.toFixed()} ${quoteToken.symbol}`);
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Sell delay: ${AUTO_SELL_DELAY === 0 ? 'false' : AUTO_SELL_DELAY}`);

  // check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(connection, wallet.publicKey, COMMITMENT_LEVEL);

  for (const ta of tokenAccounts) {
    existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
      mint: ta.accountInfo.mint,
      address: ta.pubkey,
    });
  }

  const tokenAccount = tokenAccounts.find((acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString())!;

  if (!tokenAccount) {
    throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
  }

  quoteTokenAssociatedAddress = tokenAccount.pubkey;

  // load tokens to snipe
  loadSnipeList();


  raydiumSwap = new RaydiumSwap(connection, PRIVATE_KEY);
}




async function getRaydiumPoolKey(poolState: LiquidityStateV4, connection: Connection): Promise<LiquidityPoolKeysV4> {
  const associatedPoolKeys = await Liquidity.getAssociatedPoolKeys({
    version: 4,
    marketVersion: 3,
    baseMint: poolState.baseMint,
    quoteMint: poolState.quoteMint,
    baseDecimals: poolState.baseDecimal.toNumber(),
    quoteDecimals: poolState.quoteDecimal.toNumber(),
    marketId: new PublicKey(poolState.marketId),
    programId: MAINNET_PROGRAM_ID.AmmV4,
    marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
  });

  const marketAccount = await connection.getAccountInfo(poolState.marketId, COMMITMENT_LEVEL);
  if (marketAccount === null) throw Error(' get market info error')
  const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data)

  const  targetPoolInfo  = {   
    id: associatedPoolKeys.id.toString(),
  baseMint: associatedPoolKeys.baseMint.toString(),
  quoteMint: associatedPoolKeys.quoteMint.toString(),
  lpMint: associatedPoolKeys.lpMint.toString(),
  baseDecimals: associatedPoolKeys.baseDecimals,
  quoteDecimals: associatedPoolKeys.quoteDecimals,
  lpDecimals: associatedPoolKeys.lpDecimals,
  version: 4,
  programId: associatedPoolKeys.programId.toString(),
  authority: associatedPoolKeys.authority.toString(),
  openOrders: associatedPoolKeys.openOrders.toString(),
  targetOrders: associatedPoolKeys.targetOrders.toString(),
  baseVault: associatedPoolKeys.baseVault.toString(),
  quoteVault: associatedPoolKeys.quoteVault.toString(),
  withdrawQueue: associatedPoolKeys.withdrawQueue.toString(),
  lpVault: associatedPoolKeys.lpVault.toString(),
  marketVersion: 3,
  marketProgramId: associatedPoolKeys.marketProgramId.toString(),
  marketId: associatedPoolKeys.marketId.toString(),
  marketAuthority: associatedPoolKeys.marketAuthority.toString(),
  marketBaseVault: marketInfo.baseVault.toBase58(),
  marketQuoteVault: marketInfo.quoteVault.toString(),
  marketBids: marketInfo.bids.toString(),
  marketAsks: marketInfo.asks.toString(),
  marketEventQueue: marketInfo.eventQueue.toString(),
  lookupTableAccount: PublicKey.default.toString(),
};
const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
  return poolKeys;

}



async function formatAmmKeysById(id: string, connection: Connection): Promise<LiquidityPoolKeysV4> {
  const account = await connection.getAccountInfo(new PublicKey(id), COMMITMENT_LEVEL);
  if (account === null) throw Error(' get id info error ')
  const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data)

  const marketId = info.marketId
  const marketAccount = await connection.getAccountInfo(marketId, COMMITMENT_LEVEL);
  if (marketAccount === null) throw Error(' get market info error')
  const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data)

  const lpMint = info.lpMint
  const lpMintAccount = await connection.getAccountInfo(lpMint, COMMITMENT_LEVEL);
  if (lpMintAccount === null) throw Error(' get lp mint info error')
  const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data)

  return {
    id: new PublicKey(id),
    baseMint: info.baseMint,
    quoteMint: info.quoteMint,
    lpMint: info.lpMint,
    baseDecimals: info.baseDecimal.toNumber(),
    quoteDecimals: info.quoteDecimal.toNumber(),
    lpDecimals: lpMintInfo.decimals,
    version: 4,
    programId: account.owner,
    authority: Liquidity.getAssociatedAuthority({ programId: account.owner }).publicKey,
    openOrders: info.openOrders,
    targetOrders: info.targetOrders,
    baseVault: info.baseVault,
    quoteVault: info.quoteVault,
    withdrawQueue: info.withdrawQueue,
    lpVault: info.lpVault,
    marketVersion: 3,
    marketProgramId: info.marketProgramId,
    marketId: info.marketId,
    marketAuthority: Market.getAssociatedAuthority({ programId: info.marketProgramId, marketId: info.marketId }).publicKey,
    marketBaseVault: marketInfo.baseVault,
    marketQuoteVault: marketInfo.quoteVault,
    marketBids: marketInfo.bids,
    marketAsks: marketInfo.asks,
    marketEventQueue: marketInfo.eventQueue,
    lookupTableAccount: PublicKey.default,
  }
}

function saveTokenAccount(mint: PublicKey, accountData: MinimalMarketLayoutV3) {
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const tokenAccount = <MinimalTokenAccountData>{
    address: ata,
    mint: mint,
    market: <MinimalMarketLayoutV3>{
      bids: accountData.bids,
      asks: accountData.asks,
      eventQueue: accountData.eventQueue,
    },
  };
  existingTokenAccounts.set(mint.toString(), tokenAccount);
  return tokenAccount;
}

const getPoolKeys = async (ammId: string, connection: Connection) => {
  const ammAccount = await connection.getAccountInfo(new PublicKey(ammId));
  if (ammAccount) {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(ammAccount.data);
    const marketAccount = await connection.getAccountInfo(poolState.marketId);
    if (marketAccount) {
      const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
      const marketAuthority = PublicKey.createProgramAddressSync(
        [
          marketState.ownAddress.toBuffer(),
          marketState.vaultSignerNonce.toArrayLike(Buffer, "le", 8),
        ],
        MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
      );
      return {
        id: new PublicKey(ammId),
        programId: MAINNET_PROGRAM_ID.AmmV4,
        status: poolState.status,
        baseDecimals: poolState.baseDecimal.toNumber(),
        quoteDecimals: poolState.quoteDecimal.toNumber(),
        lpDecimals: 9,
        baseMint: poolState.baseMint,
        quoteMint: poolState.quoteMint,
        version: 4,
        authority: new PublicKey(
          "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        ),
        openOrders: poolState.openOrders,
        baseVault: poolState.baseVault,
        quoteVault: poolState.quoteVault,
        marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
        marketId: marketState.ownAddress,
        marketBids: marketState.bids,
        marketAsks: marketState.asks,
        marketEventQueue: marketState.eventQueue,
        marketBaseVault: marketState.baseVault,
        marketQuoteVault: marketState.quoteVault,
        marketAuthority: marketAuthority,
        targetOrders: poolState.targetOrders,
        lpMint: poolState.lpMint,
      } as unknown as LiquidityPoolKeys;
    }
  }
};

const executeTransaction = async (ammId: string, swapAmountIn: number, tokenToBuy: string, keyPair: Keypair, poolKeys: LiquidityPoolKeysV4) => {
  // const connection = new Connection("https://api.mainnet-beta.solana.com");
  // const secretKey = Uint8Array.from(
  //   JSON.parse(fs.readFileSync(`./keypair.json`) as unknown as string),
  // );
  // const keyPair = Keypair.fromSecretKey(secretKey);
  //const ammId = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"; // Address of the SOL-USDC pool on mainnet
  const slippage = 90; // 2% slippage tolerance

  //const poolKeys = await getPoolKeys(ammId, connection);
  console.log(poolKeys);
  if (poolKeys) {
    const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    const txn = new Transaction();
    const {
      swapIX,
      tokenInAccount,
      tokenIn,
      amountIn
    } = await makeSwapInstruction(
      connection,
      tokenToBuy,
      swapAmountIn,
      slippage,
      poolKeys,
      poolInfo,
      keyPair,
    );
    if (tokenIn.toString() == WSOL.mint) {
      // Convert SOL to Wrapped SOL
      txn.add(
        SystemProgram.transfer({
          fromPubkey: keyPair.publicKey,
          toPubkey: tokenInAccount,
          lamports: amountIn.raw.toNumber(),
        }),
        createSyncNativeInstruction(tokenInAccount, TOKEN_PROGRAM_ID),
      );
    }
    txn.add(swapIX);

    // const hash = await sendAndConfirmTransaction(connection, txn, [keyPair], {
    //   skipPreflight: false,
    //   preflightCommitment: "confirmed",
    // });



    const simRes = true
      // @ts-ignore
      ? await raydiumSwap.simulateVersionedTransaction(txn as VersionedTransaction)
      // @ts-ignore
      : await raydiumSwap.simulateLegacyTransaction(txn as Transaction);

    console.log(simRes);

    console.log("Transaction Completed Successfully 🎉🚀.");
    // console.log(`Explorer URL: https://solscan.io/tx/${hash}`);
  } else {
    console.log(`Could not get PoolKeys for AMM: ${ammId}`);
  }
};


export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {
  // if (!shouldBuy(poolState.baseMint.toString())) {
  //   return;
  // }

  const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);
  logger.info(`Processing pool: ${id.toString()} with ${poolSize.toFixed()} ${quoteToken.symbol} in liquidity`);

  // if (!quoteMinPoolSizeAmount.isZero()) {


  //   if (poolSize.lt(quoteMinPoolSizeAmount)) {
  //     logger.warn(
  //       {
  //         mint: poolState.baseMint,
  //         pooled: `${poolSize.toFixed()} ${quoteToken.symbol}`,
  //       },
  //       `Skipping pool, smaller than ${quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
  //       `Swap quote in amount: ${poolSize.toFixed()}`,
  //     );
  //     return;
  //   }
  // }

  if (CHECK_IF_MINT_IS_RENOUNCED) {
    const mintOption = await checkMintable(poolState.baseMint);

    if (mintOption !== true) {
      logger.warn({ mint: poolState.baseMint }, 'Skipping, owner can mint tokens!');
      return;
    }
  }

  try {

    //let poolInfo = await raydiumSwap.findRaydiumPoolInfo(poolState.baseMint.toBase58(), poolState.quoteMint.toBase58());
    //let poolInfo = await formatAmmKeysById(id.toBase58(), connection);
    const poolInfo = await getRaydiumPoolKey(poolState, connection);
 

    

     await buy(id, poolState, poolInfo!);

  } catch (e) {
    console.log(e);
    //logger.debug(e);
    // logger.error({ mint: poolState.baseMint }, `Failed to process market`);
  }



 
}

export async function checkMintable(vault: PublicKey): Promise<boolean | undefined> {
  try {
    let { data } = (await connection.getAccountInfo(vault)) || {};
    if (!data) {
      return;
    }
    const deserialize = MintLayout.decode(data);
    return deserialize.mintAuthorityOption === 0;
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: vault }, `Failed to check if mint is renounced`);
  }
}

export async function processOpenBookMarket(updatedAccountInfo: KeyedAccountInfo) {
  let accountData: MarketStateV3 | undefined;
  try {
    accountData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);

    // to be competitive, we collect market data before buying the token...
    if (existingTokenAccounts.has(accountData.baseMint.toString())) {
      return;
    }

    saveTokenAccount(accountData.baseMint, accountData);
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData?.baseMint }, `Failed to process market`);
  }
}

const makeSwapInstruction = async (
  connection: Connection,
  tokenToBuy: string,
  rawAmountIn: number,
  slippage: number,
  poolKeys: LiquidityPoolKeys,
  poolInfo: LiquidityPoolInfo,
  keyPair: Keypair,
) => {
  const { amountIn, tokenIn, tokenOut, minAmountOut } =
    await calculateAmountOut(
      poolKeys,
      poolInfo,
      tokenToBuy,
      rawAmountIn,
      slippage,
    );
  let tokenInAccount: PublicKey;
  let tokenOutAccount: PublicKey;

  if (tokenIn.toString() == WSOL.mint) {
    tokenInAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        keyPair,
        NATIVE_MINT,
        keyPair.publicKey,
      )
    ).address;
    tokenOutAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        keyPair,
        tokenOut,
        keyPair.publicKey,
      )
    ).address;
  } else {
    tokenOutAccount = await createWrappedNativeAccount(
      connection,
      keyPair,
      keyPair.publicKey,
      0,
    );
    tokenInAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        keyPair,
        tokenOut,
        keyPair.publicKey,
      )
    ).address;
  }

  const ix = new TransactionInstruction({
    programId: new PublicKey(poolKeys.programId),
    keys: [
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: poolKeys.id, isSigner: false, isWritable: true },
      { pubkey: poolKeys.authority, isSigner: false, isWritable: false },
      { pubkey: poolKeys.openOrders, isSigner: false, isWritable: true },
      { pubkey: poolKeys.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.quoteVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketProgramId, isSigner: false, isWritable: false },
      { pubkey: poolKeys.marketId, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketBids, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketAsks, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketEventQueue, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketBaseVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketQuoteVault, isSigner: false, isWritable: true },
      { pubkey: poolKeys.marketAuthority, isSigner: false, isWritable: false },
      { pubkey: tokenInAccount, isSigner: false, isWritable: true },
      { pubkey: tokenOutAccount, isSigner: false, isWritable: true },
      { pubkey: keyPair.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(
      Uint8Array.of(
        9,
        ...new BN(amountIn.raw).toArray("le", 8),
        ...new BN(minAmountOut.raw).toArray("le", 8),
      ),
    ),
  });
  return {
    swapIX: ix,
    tokenInAccount: tokenInAccount,
    tokenOutAccount: tokenOutAccount,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
  };
};

const calculateAmountOut = async (
  poolKeys: LiquidityPoolKeys,
  poolInfo: LiquidityPoolInfo,
  tokenToBuy: string,
  amountIn: number,
  rawSlippage: number,
) => {
  let tokenOutMint = new PublicKey(tokenToBuy);
  let tokenOutDecimals =
    poolKeys.baseMint == tokenOutMint
      ? poolInfo.baseDecimals
      : poolKeys.quoteDecimals;
  let tokenInMint =
    poolKeys.baseMint == tokenOutMint ? poolKeys.quoteMint : poolKeys.baseMint;
  let tokenInDecimals =
    poolKeys.baseMint == tokenOutMint
      ? poolInfo.quoteDecimals
      : poolInfo.baseDecimals;

  const tokenIn = new Token(TOKEN_PROGRAM_ID, tokenInMint, tokenInDecimals);
  const tknAmountIn = new TokenAmount(tokenIn, amountIn, false);
  const tokenOut = new Token(TOKEN_PROGRAM_ID, tokenOutMint, tokenOutDecimals);
  const slippage = new Percent(rawSlippage, 100);
  return {
    amountIn: tknAmountIn,
    tokenIn: tokenInMint,
    tokenOut: tokenOutMint,
    ...Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn: tknAmountIn,
      currencyOut: tokenOut,
      slippage,
    }),
  };
};

const swap = async (swapConfig: any) => {
  /**
   * The RaydiumSwap instance for handling swaps.
   */

  console.log(`Raydium swap initialized`);
  console.log(`Swapping ${swapConfig.tokenAAmount} of ${swapConfig.tokenAAddress} for ${swapConfig.tokenBAddress}`)

  /**
   * Load pool keys from the Raydium API to enable finding pool information.
   */
  // await raydiumSwap.loadPoolKeys(swapConfig.liquidityFile);
  // console.log(`Loaded pool keys`);

  /**
   * Find pool information for the given token pair.
   */
  // const poolInfo = raydiumSwap.findPoolInfoForTokens(swapConfig.tokenAAddress, swapConfig.tokenBAddress);
  // const poolInfo2 = swapConfig.poolInfo;
  // console.log('Found pool info');
  // console.log("poolInfo");
  // console.log({
  //     poolInfo,
  //     poolInfo2
  // });

  /**
   * Prepare the swap transaction with the given parameters.
   */
  const tx = await raydiumSwap.getSwapTransaction(
    swapConfig.tokenBAddress,
    swapConfig.tokenAAmount,
    swapConfig.poolInfo,
    swapConfig.maxLamports,
    swapConfig.useVersionedTransaction,
    swapConfig.direction
  );

  /**
   * Depending on the configuration, execute or simulate the swap.
   */
  if (swapConfig.executeSwap) {
    /**
     * Send the transaction to the network and log the transaction ID.
     */
    const txid = swapConfig.useVersionedTransaction
      // @ts-ignore
      ? await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction, swapConfig.maxRetries)
      // @ts-ignore
      : await raydiumSwap.sendLegacyTransaction(tx as Transaction, swapConfig.maxRetries);

    console.log(`https://solscan.io/tx/${txid}`);

  } else {
    /**
     * Simulate the transaction and log the result.
     */
    const simRes = swapConfig.useVersionedTransaction
      // @ts-ignore
      ? await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction)
      // @ts-ignore
      : await raydiumSwap.simulateLegacyTransaction(tx as Transaction);

    console.log(simRes);
  }
};

async function buy(accountId: PublicKey, accountData: LiquidityStateV4, poolKeys:LiquidityPoolKeysV4 ): Promise<void> {
  try {
    let tokenAccount = existingTokenAccounts.get(accountData.baseMint.toString());

    if (!tokenAccount) {
      // it's possible that we didn't have time to fetch open book data
      const market = await getMinimalMarketV3(connection, accountData.marketId, COMMITMENT_LEVEL);
      tokenAccount = saveTokenAccount(accountData.baseMint, market);
    }

    //tokenAccount.poolKeys = createPoolKeys(accountId, accountData, tokenAccount.market!);
    tokenAccount.poolKeys = poolKeys
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: tokenAccount.poolKeys,
        userKeys: {
          tokenAccountIn: quoteTokenAssociatedAddress,
          tokenAccountOut: tokenAccount.address,
          owner: wallet.publicKey,
        },
        amountIn: quoteAmount.raw,
        minAmountOut: 0,
      },
      tokenAccount.poolKeys.version,
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
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          tokenAccount.address,
          wallet.publicKey,
          accountData.baseMint,
        ),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);
    const endDate = new Date();
    const diff = endDate.getTime() - initDate.getTime();
    console.log(`Time to buy: ${diff} ms`);
    console.log('initDate', initDate)
    console.log('endDate', endDate)

    const simRes = await raydiumSwap.simulateVersionedTransaction(transaction as VersionedTransaction)

        console.log(simRes)
    

    // const signature = await connection.sendRawTransaction(transaction.serialize(), {
    //   preflightCommitment: COMMITMENT_LEVEL,
    // });
    // logger.info({ mint: accountData.baseMint, signature }, `Sent buy tx`);
    // const confirmation = await connection.confirmTransaction(
    //   {
    //     signature,
    //     lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    //     blockhash: latestBlockhash.blockhash,
    //   },
    //   COMMITMENT_LEVEL,
    // );
    // if (!confirmation.value.err) {
    //   logger.info(
    //     {
    //       mint: accountData.baseMint,
    //       signature,
    //       url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
    //     },
    //     `Confirmed buy tx`,
    //   );
    // } else {
    //   logger.debug(confirmation.value.err);
    //   logger.info({ mint: accountData.baseMint, signature }, `Error confirming buy tx`);
    // }
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData.baseMint }, `Failed to buy token`);
  }
}

async function sell(accountId: PublicKey, mint: PublicKey, amount: BigNumberish): Promise<void> {
  let sold = false;
  let retries = 0;

  if (AUTO_SELL_DELAY > 0) {
    await new Promise((resolve) => setTimeout(resolve, AUTO_SELL_DELAY));
  }

  do {
    try {
      const tokenAccount = existingTokenAccounts.get(mint.toString());

      if (!tokenAccount) {
        return;
      }

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

function loadSnipeList() {
  if (!USE_SNIPE_LIST) {
    return;
  }

  const count = snipeList.length;
  const data = fs.readFileSync(path.join(__dirname, 'snipe-list.txt'), 'utf-8');
  snipeList = data
    .split('\n')
    .map((a) => a.trim())
    .filter((a) => a);

  if (snipeList.length != count) {
    logger.info(`Loaded snipe list: ${snipeList.length}`);
  }
}

function shouldBuy(key: string): boolean {
  return USE_SNIPE_LIST ? snipeList.includes(key) : true;
}
let initDate = new Date()
const runListener = async () => {
  await init();
  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const raydiumSubscriptionId = connection.onProgramAccountChange(
    RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    async (updatedAccountInfo) => {
      initDate = new Date()
      const key = updatedAccountInfo.accountId.toString();
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
      const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
      const existing = existingLiquidityPools.has(key);

      if (poolOpenTime > runTimestamp && !existing) {
        existingLiquidityPools.add(key);
        const _ = processRaydiumPool(updatedAccountInfo.accountId, poolState);
      }
    },
    COMMITMENT_LEVEL,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
          bytes: OPENBOOK_PROGRAM_ID.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
        },
      },
    ],
  );

  const openBookSubscriptionId = connection.onProgramAccountChange(
    OPENBOOK_PROGRAM_ID,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString();
      const existing = existingOpenBookMarkets.has(key);
      if (!existing) {
        existingOpenBookMarkets.add(key);
        const _ = processOpenBookMarket(updatedAccountInfo);
      }
    },
    COMMITMENT_LEVEL,
    [
      { dataSize: MARKET_STATE_LAYOUT_V3.span },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
    ],
  );

  if (AUTO_SELL) {
    const walletSubscriptionId = connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo!.data);

        if (updatedAccountInfo.accountId.equals(quoteTokenAssociatedAddress)) {
          return;
        }

        const _ = sell(updatedAccountInfo.accountId, accountData.mint, accountData.amount);
      },
      COMMITMENT_LEVEL,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ],
    );

    logger.info(`Listening for wallet changes: ${walletSubscriptionId}`);
  }

  logger.info(`Listening for raydium changes: ${raydiumSubscriptionId}`);
  logger.info(`Listening for open book changes: ${openBookSubscriptionId}`);

  if (USE_SNIPE_LIST) {
    setInterval(loadSnipeList, SNIPE_LIST_REFRESH_INTERVAL);
  }
};

runListener();
