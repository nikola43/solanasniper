import { LiquidityPoolKeysV4, MARKET_STATE_LAYOUT_V3, Market, TOKEN_PROGRAM_ID, Token, TokenAmount } from "@raydium-io/raydium-sdk";
import { Connection, Logs, ParsedInnerInstruction, ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import RaydiumSwap from './RaydiumSwap';
let RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
const RAYDIUM_POOL_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const SERUM_OPENBOOK_PROGRAM_ID = 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;
require('dotenv').config()
import { logger } from './utils';

const SESSION_HASH = 'QNDEMO' + Math.ceil(Math.random() * 1e9); // Random unique identifier for your session
const HTTP_RPC = "https://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
const WS_RPC = "wss://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
//const HTTP_RPC = "https://solana-mainnet.core.chainstack.com/444a9722c51931fbf1f90e396ce78229";
//const WS_RPC = "wss://solana-mainnet.core.chainstack.com/ws/444a9722c51931fbf1f90e396ce78229";
let connection = new Connection(HTTP_RPC, {
    wsEndpoint: WS_RPC,
    httpHeaders: { "x-session-hash": SESSION_HASH }
});

connection = new Connection(RPC_ENDPOINT);

const seenTransactions: Array<string> = []; // The log listener is sometimes triggered multiple times for a single transaction, don't react to tranasctions we've already seen

subscribeToNewRaydiumPools();

let quoteMinPoolSizeAmount: TokenAmount;
let quoteToken = Token.WSOL;

quoteMinPoolSizeAmount = new TokenAmount(quoteToken, 1, false);


const swap = async (swapConfig) => {
    /**
     * The RaydiumSwap instance for handling swaps.
     */
    const raydiumSwap = new RaydiumSwap(connection, process.env.WALLET_PRIVATE_KEY);
    console.log(`Raydium swap initialized`);
    console.log(`Swapping ${swapConfig.tokenAAmount} of ${swapConfig.tokenAAddress} for ${swapConfig.tokenBAddress}...`)

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

function subscribeToNewRaydiumPools(): void {
    connection.onLogs(new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID), async (txLogs: Logs) => {
        // console.log("Log entry found", new Date());
        if (seenTransactions.includes(txLogs.signature)) {
            return;
        }
        seenTransactions.push(txLogs.signature);
        //if (!findLogEntry('initialize2', txLogs.logs)) {
        if (!findLogEntry('init_pc_amount', txLogs.logs)) {
            return; // If "init_pc_amount" is not in log entries then it's not LP initialization transaction
        }
   

        /*
        if (!quoteMinPoolSizeAmount.isZero()) {
            const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);
            logger.info(`Processing pool: ${id.toString()} with ${poolSize.toFixed()} ${quoteToken.symbol} in liquidity`);

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
        */

        const poolKeys = await fetchPoolKeysForLPInitTransactionHash(txLogs.signature); // With poolKeys you can do a swap

        const tokens = await fetchRaydiumAccounts(txLogs.signature, connection);
        console.log("Tokens");

        const inputToken = tokens.tokenAAccount.toBase58() === "So11111111111111111111111111111111111111112" ? tokens.tokenAAccount.toBase58() : tokens.tokenBAccount.toBase58();
        const outputToken = tokens.tokenAAccount.toBase58() === "So11111111111111111111111111111111111111112" ? tokens.tokenBAccount.toBase58() : tokens.tokenAAccount.toBase58();

        const swapConfig = {
            executeSwap: false, // Send tx when true, simulate tx when false
            useVersionedTransaction: true,
            tokenAAmount: 0.0056, // Swap 0.01 SOL for USDT in this example
            tokenAAddress: inputToken, // Token to swap for the other, SOL in this case
            tokenBAddress: outputToken, // USDC address
            maxLamports: 1500000, // Micro lamports for priority fee
            direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
            maxRetries: 20,
            poolInfo: poolKeys
        };

        swap(swapConfig);
        return



        //console.log(poolKeys);
    });
    console.log('Listening to new pools...');
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