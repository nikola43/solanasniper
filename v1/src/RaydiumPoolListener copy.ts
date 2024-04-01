import { LIQUIDITY_STATE_LAYOUT_V4, LiquidityPoolKeysV4, LiquidityStateV4, LiquidityPoolKeys, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Market, TOKEN_PROGRAM_ID, Token, TokenAmount } from "@raydium-io/raydium-sdk";
import { Connection, Logs, ParsedInnerInstruction, ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import RaydiumSwap from './RaydiumSwap';
let RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
//import open, {openApp, apps} from 'open';




export interface MinimalTokenAccountData {
    mint: PublicKey;
    address: PublicKey;
    poolKeys?: LiquidityPoolKeys;
    market?: MinimalMarketLayoutV3;
}

export const RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = MAINNET_PROGRAM_ID.AmmV4;

export const OPENBOOK_PROGRAM_ID = MAINNET_PROGRAM_ID.OPENBOOK_MARKET;
const RAYDIUM_POOL_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;
require('dotenv').config()
import { logger } from './utils';
import bs58 from "bs58";
import { MintLayout } from "./types";
import { createPoolKeys, getTokenAccounts } from "./liquidity";
import { MinimalMarketLayoutV3, getMinimalMarketV3 } from "./market";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getTokenMetadata } from "./metadata";
const COMMITMENT_LEVEL = 'confirmed';
const SESSION_HASH = 'QNDEMO' + Math.ceil(Math.random() * 1e9); // Random unique identifier for your session
// const HTTP_RPC = "https://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
// const WS_RPC = "wss://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
// const HTTP_RPC = "https://solana-mainnet.core.chainstack.com/444a9722c51931fbf1f90e396ce78229";
// const WS_RPC = "wss://solana-mainnet.core.chainstack.com/ws/444a9722c51931fbf1f90e396ce78229";
// const HTTP_RPC = "https://go.getblock.io/7b03a7b0a0504f0c85fc7b4e0f964a2e";
// const WS_RPC = "wss://go.getblock.io/4303487ead6e4910a59442ebcf41ca90";
// const HTTP_RPC = "https://solana-mainnet.g.alchemy.com/v2/t6NM_t_FBM1RuEDylICqYjfaqLESjUPN";
// const WS_RPC = "wss://solana-mainnet.g.alchemy.com/v2/t6NM_t_FBM1RuEDylICqYjfaqLESjUPN";
//const HTTP_RPC = "https://mainnet.helius-rpc.com/?api-key=e26bf879-6bb4-49c0-aafa-8e4d86687455";
const HTTP_RPC = "https://rpc.shyft.to?api_key=tbe9OcyS6qotgfHw";
let connection = new Connection(HTTP_RPC);

// let connection = new Connection(HTTP_RPC, {
//     wsEndpoint: WS_RPC,
//     httpHeaders: { "x-session-hash": SESSION_HASH }
// });
const raydiumSwap = new RaydiumSwap(connection, process.env.WALLET_PRIVATE_KEY);


const seenTransactions: Array<string> = []; // The log listener is sometimes triggered multiple times for a single transaction, don't react to tranasctions we've already seen

let quoteMinPoolSizeAmount: TokenAmount;
let quoteToken = Token.WSOL;
quoteMinPoolSizeAmount = new TokenAmount(quoteToken, 2, false);

subscribeToNewRaydiumPools();




const swap = async (swapConfig) => {
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

function saveTokenAccount(mint: PublicKey, accountData: MinimalMarketLayoutV3) {
    const ata = getAssociatedTokenAddressSync(mint, raydiumSwap.wallet.publicKey);
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

export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {

    const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);
    const quoteMint = poolState.quoteMint
    const baseMint = poolState.baseMint

    const tokenMetadata = await getTokenMetadata(baseMint, connection)
    logger.info(`Processing pool: ${id.toString()} with ${poolSize.toFixed()} ${quoteToken.symbol} in liquidity`);
    logger.info(`Token: ${tokenMetadata.symbol}  ${baseMint.toBase58()}`);

    //const poolInfo = parsePoolInfoFromLpTransaction(tx);


    /*
// Check if pool size is larger than the minimum pool size
if (!quoteMinPoolSizeAmount.isZero()) {
    if (poolSize.lt(quoteMinPoolSizeAmount)) {
        logger.warn(
            {
                mint: poolState.baseMint,
                pooled: `${poolSize.toFixed()} ${quoteToken.symbol}`,
            },
            `Skipping pool, smaller than ${quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
            `Swap quote in amount: ${poolSize.toFixed()}`,
        );
        return;
    }
}

// if (CHECK_IF_MINT_IS_RENOUNCED) {

if (true) {
    const mintOption = await checkMintable(poolState.baseMint);

    if (mintOption !== true) {
        logger.warn({ mint: poolState.baseMint }, 'Skipping, owner can mint tokens!');
        return;
    }
}
*/

    // let tokenAccount = existingTokenAccounts.get(poolState.baseMint.toString());
    // console.log("Processing pool", id.toString());
    // console.log("Pool state", poolState);

    // const tokenAccounts = await getTokenAccounts(connection, raydiumSwap.wallet.publicKey, COMMITMENT_LEVEL);
    // for (const ta of tokenAccounts) {
    //     existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
    //         mint: ta.accountInfo.mint,
    //         address: ta.pubkey,
    //     });
    // }

    // if (!tokenAccount) {
    //     // it's possible that we didn't have time to fetch open book data
    //     const market = await getMinimalMarketV3(connection, poolState.marketId, COMMITMENT_LEVEL);
    //     tokenAccount = saveTokenAccount(poolState.baseMint, market);
    // }


    // // let tokenAccount = existingTokenAccounts.get(poolState.baseMint.toString());
    // //const marketInfo = await fetchMarketInfo(poolState.marketId);
    // const poolKeys = createPoolKeys(id, poolState, tokenAccount.market!);



    // const swapConfig = {
    //     executeSwap: false, // Send tx when true, simulate tx when false
    //     useVersionedTransaction: true,
    //     tokenAAmount: 0.01, // Swap 0.01 SOL for USDT in this example
    //     tokenAAddress: poolState.quoteMint.toBase58(), // Token to swap for the other, SOL in this case
    //     tokenBAddress: poolState.baseMint.toBase58(), // USDC address
    //     maxLamports: 1500000, // Micro lamports for priority fee
    //     direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
    //     maxRetries: 20,
    //     poolInfo: poolKeys
    //     //poolInfo: createPoolKeys(id, poolState, marketInfo)
    // };

    // open('https://photon-sol.tinyastro.io/en/lp/' + id.toString());


    // swap(swapConfig);


    // await buy(id, poolState);
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


const runTimestamp = Math.floor(new Date().getTime() / 1000);


const existingLiquidityPools: Set<string> = new Set<string>();

function subscribeToNewRaydiumPools(): void {
    const raydiumSubscriptionId = connection.onProgramAccountChange(
        new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID),
        async (updatedAccountInfo) => {
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
}

function generateExplorerUrl(txId) {
    return `https://solscan.io/tx/${txId}`;
}

// Parse transaction and filter data
async function fetchRaydiumAccounts(txId: string, connection: Connection) {
    const tx = await connection.getParsedTransaction(
        txId,
        {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

    //credits += 100;

    //const accounts = tx?.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY).accounts;
    const txInstructions: PartiallyDecodedInstruction | ParsedInstruction = tx?.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_POOL_V4_PROGRAM_ID)
    let accounts: PublicKey[] | undefined = undefined;
    if ('accounts' in txInstructions) {
        accounts = txInstructions.accounts;
    }
    if (!accounts) {
        console.log("No accounts found in the transaction.");
        return;
    }

    const tokenAIndex = 8;
    const tokenBIndex = 9;

    const tokenAAccount = accounts[tokenAIndex];
    const tokenBAccount = accounts[tokenBIndex];

    const displayData = [
        { "Token": "A", "Account Public Key": tokenAAccount.toBase58() },
        { "Token": "B", "Account Public Key": tokenBAccount.toBase58() },
        { "Signature": "ID", txId }
    ];
    console.log("New LP Found");
    console.log(generateExplorerUrl(txId));
    console.table(displayData);
    //console.log("Total QuickNode Credits Used in this session:", credits);

    return { tokenAAccount, tokenBAccount };
}

function findLogEntry(needle: string, logEntries: Array<string>): string | null {
    for (let i = 0; i < logEntries.length; ++i) {
        if (logEntries[i].includes(needle)) {
            return logEntries[i];
        }
    }

    return null;
}

async function fetchPoolKeysForLPInitTransactionHash(txSignature: string): Promise<LiquidityPoolKeysV4> {
    const tx = await connection.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
    if (!tx) {
        throw new Error('Failed to fetch transaction with signature ' + txSignature);
    }
    const poolInfo = parsePoolInfoFromLpTransaction(tx);
    const marketInfo = await fetchMarketInfo(poolInfo.marketId);

    return {
        id: poolInfo.id,
        baseMint: poolInfo.baseMint,
        quoteMint: poolInfo.quoteMint,
        lpMint: poolInfo.lpMint,
        baseDecimals: poolInfo.baseDecimals,
        quoteDecimals: poolInfo.quoteDecimals,
        lpDecimals: poolInfo.lpDecimals,
        version: 4,
        programId: poolInfo.programId,
        authority: poolInfo.authority,
        openOrders: poolInfo.openOrders,
        targetOrders: poolInfo.targetOrders,
        baseVault: poolInfo.baseVault,
        quoteVault: poolInfo.quoteVault,
        withdrawQueue: poolInfo.withdrawQueue,
        lpVault: poolInfo.lpVault,
        marketVersion: 3,
        marketProgramId: poolInfo.marketProgramId,
        marketId: poolInfo.marketId,
        marketAuthority: Market.getAssociatedAuthority({ programId: poolInfo.marketProgramId, marketId: poolInfo.marketId }).publicKey,
        marketBaseVault: marketInfo.baseVault,
        marketQuoteVault: marketInfo.quoteVault,
        marketBids: marketInfo.bids,
        marketAsks: marketInfo.asks,
        marketEventQueue: marketInfo.eventQueue,
    } as LiquidityPoolKeysV4;
}

async function fetchPoolKeysForLPInitTransactionHashV2(txSignature: string): Promise<LiquidityPoolKeysV4> {
    const tx = await connection.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
    if (!tx) {
        throw new Error('Failed to fetch transaction with signature ' + txSignature);
    }
    const poolInfo = parsePoolInfoFromLpTransaction(tx);
    const marketInfo = await fetchMarketInfo(poolInfo.marketId);

    return {
        id: poolInfo.id,
        baseMint: poolInfo.baseMint,
        quoteMint: poolInfo.quoteMint,
        lpMint: poolInfo.lpMint,
        baseDecimals: poolInfo.baseDecimals,
        quoteDecimals: poolInfo.quoteDecimals,
        lpDecimals: poolInfo.lpDecimals,
        version: 4,
        programId: poolInfo.programId,
        authority: poolInfo.authority,
        openOrders: poolInfo.openOrders,
        targetOrders: poolInfo.targetOrders,
        baseVault: poolInfo.baseVault,
        quoteVault: poolInfo.quoteVault,
        withdrawQueue: poolInfo.withdrawQueue,
        lpVault: poolInfo.lpVault,
        marketVersion: 3,
        marketProgramId: poolInfo.marketProgramId,
        marketId: poolInfo.marketId,
        marketAuthority: Market.getAssociatedAuthority({ programId: poolInfo.marketProgramId, marketId: poolInfo.marketId }).publicKey,
        marketBaseVault: marketInfo.baseVault,
        marketQuoteVault: marketInfo.quoteVault,
        marketBids: marketInfo.bids,
        marketAsks: marketInfo.asks,
        marketEventQueue: marketInfo.eventQueue,
    } as LiquidityPoolKeysV4;
}

async function fetchMarketInfo(marketId: PublicKey) {
    const marketAccountInfo = await connection.getAccountInfo(marketId);
    if (!marketAccountInfo) {
        throw new Error('Failed to fetch market info for market id ' + marketId.toBase58());
    }

    return MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
}


function parsePoolInfoFromLpTransaction(txData: ParsedTransactionWithMeta) {
    const initInstruction = findInstructionByProgramId(txData.transaction.message.instructions, new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID)) as PartiallyDecodedInstruction | null;
    if (!initInstruction) {
        throw new Error('Failed to find lp init instruction in lp init tx');
    }
    const baseMint = initInstruction.accounts[8];
    const baseVault = initInstruction.accounts[10];
    const quoteMint = initInstruction.accounts[9];
    const quoteVault = initInstruction.accounts[11];
    const lpMint = initInstruction.accounts[7];
    const baseAndQuoteSwapped = baseMint.toBase58() === SOL_MINT;
    const lpMintInitInstruction = findInitializeMintInInnerInstructionsByMintAddress(txData.meta?.innerInstructions ?? [], lpMint);
    if (!lpMintInitInstruction) {
        throw new Error('Failed to find lp mint init instruction in lp init tx');
    }
    const lpMintInstruction = findMintToInInnerInstructionsByMintAddress(txData.meta?.innerInstructions ?? [], lpMint);
    if (!lpMintInstruction) {
        throw new Error('Failed to find lp mint to instruction in lp init tx');
    }
    const baseTransferInstruction = findTransferInstructionInInnerInstructionsByDestination(txData.meta?.innerInstructions ?? [], baseVault, TOKEN_PROGRAM_ID);
    if (!baseTransferInstruction) {
        throw new Error('Failed to find base transfer instruction in lp init tx');
    }
    const quoteTransferInstruction = findTransferInstructionInInnerInstructionsByDestination(txData.meta?.innerInstructions ?? [], quoteVault, TOKEN_PROGRAM_ID);
    if (!quoteTransferInstruction) {
        throw new Error('Failed to find quote transfer instruction in lp init tx');
    }
    const lpDecimals = lpMintInitInstruction.parsed.info.decimals;
    const lpInitializationLogEntryInfo = extractLPInitializationLogEntryInfoFromLogEntry(findLogEntry('init_pc_amount', txData.meta?.logMessages ?? []) ?? '');
    const basePreBalance = (txData.meta?.preTokenBalances ?? []).find(balance => balance.mint === baseMint.toBase58());
    if (!basePreBalance) {
        throw new Error('Failed to find base tokens preTokenBalance entry to parse the base tokens decimals');
    }
    const baseDecimals = basePreBalance.uiTokenAmount.decimals;

    return {
        id: initInstruction.accounts[4],
        baseMint,
        quoteMint,
        lpMint,
        baseDecimals: baseAndQuoteSwapped ? SOL_DECIMALS : baseDecimals,
        quoteDecimals: baseAndQuoteSwapped ? baseDecimals : SOL_DECIMALS,
        lpDecimals,
        version: 4,
        programId: new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID),
        authority: initInstruction.accounts[5],
        openOrders: initInstruction.accounts[6],
        targetOrders: initInstruction.accounts[13],
        baseVault,
        quoteVault,
        withdrawQueue: new PublicKey("11111111111111111111111111111111"),
        lpVault: new PublicKey(lpMintInstruction.parsed.info.account),
        marketVersion: 3,
        marketProgramId: initInstruction.accounts[15],
        marketId: initInstruction.accounts[16],
        baseReserve: parseInt(baseTransferInstruction.parsed.info.amount),
        quoteReserve: parseInt(quoteTransferInstruction.parsed.info.amount),
        lpReserve: parseInt(lpMintInstruction.parsed.info.amount),
        openTime: lpInitializationLogEntryInfo.open_time,
    }
}

function findTransferInstructionInInnerInstructionsByDestination(innerInstructions: Array<ParsedInnerInstruction>, destinationAccount: PublicKey, programId?: PublicKey): ParsedInstruction | null {
    for (let i = 0; i < innerInstructions.length; i++) {
        for (let y = 0; y < innerInstructions[i].instructions.length; y++) {
            const instruction = innerInstructions[i].instructions[y] as ParsedInstruction;
            if (!instruction.parsed) { continue };
            if (instruction.parsed.type === 'transfer' && instruction.parsed.info.destination === destinationAccount.toBase58() && (!programId || instruction.programId.equals(programId))) {
                return instruction;
            }
        }
    }

    return null;
}

function findInitializeMintInInnerInstructionsByMintAddress(innerInstructions: Array<ParsedInnerInstruction>, mintAddress: PublicKey): ParsedInstruction | null {
    for (let i = 0; i < innerInstructions.length; i++) {
        for (let y = 0; y < innerInstructions[i].instructions.length; y++) {
            const instruction = innerInstructions[i].instructions[y] as ParsedInstruction;
            if (!instruction.parsed) { continue };
            if (instruction.parsed.type === 'initializeMint' && instruction.parsed.info.mint === mintAddress.toBase58()) {
                return instruction;
            }
        }
    }

    return null;
}

function findMintToInInnerInstructionsByMintAddress(innerInstructions: Array<ParsedInnerInstruction>, mintAddress: PublicKey): ParsedInstruction | null {
    for (let i = 0; i < innerInstructions.length; i++) {
        for (let y = 0; y < innerInstructions[i].instructions.length; y++) {
            const instruction = innerInstructions[i].instructions[y] as ParsedInstruction;
            if (!instruction.parsed) { continue };
            if (instruction.parsed.type === 'mintTo' && instruction.parsed.info.mint === mintAddress.toBase58()) {
                return instruction;
            }
        }
    }

    return null;
}

function findInstructionByProgramId(instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>, programId: PublicKey): ParsedInstruction | PartiallyDecodedInstruction | null {
    for (let i = 0; i < instructions.length; i++) {
        if (instructions[i].programId.equals(programId)) {
            return instructions[i];
        }
    }

    return null;
}

function extractLPInitializationLogEntryInfoFromLogEntry(lpLogEntry: string): { nonce: number, open_time: number, init_pc_amount: number, init_coin_amount: number } {
    const lpInitializationLogEntryInfoStart = lpLogEntry.indexOf('{');

    return JSON.parse(fixRelaxedJsonInLpLogEntry(lpLogEntry.substring(lpInitializationLogEntryInfoStart)));
}

function fixRelaxedJsonInLpLogEntry(relaxedJson: string): string {
    return relaxedJson.replace(/([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "$1\"$2\":");
}