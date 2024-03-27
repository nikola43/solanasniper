import { PublicKey, Connection, Commitment, PartiallyDecodedInstruction, ParsedInstruction } from "@solana/web3.js"
import {
    LIQUIDITY_STATE_LAYOUT_V4,
    MARKET_STATE_LAYOUT_V3,
} from "@raydium-io/raydium-sdk";

import RaydiumSwap from './RaydiumSwap';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import 'dotenv/config';
// import { swapConfig } from './swapConfig'; // Import the configuration
const { Worker } = require('worker_threads')

const RAYDIUM_PUBLIC_KEY = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";


let credits = 0;

const raydium = new PublicKey(RAYDIUM_PUBLIC_KEY);


const SESSION_HASH = 'QNDEMO' + Math.ceil(Math.random() * 1e9); // Random unique identifier for your session
const HTTP_URL = "https://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
const WS_URL = "wss://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/";
const connection = new Connection(HTTP_URL, {
    wsEndpoint: WS_URL,
    httpHeaders: { "x-session-hash": SESSION_HASH }
});

// Define a function to fetch and decode Market accounts
async function fetchMarketAccounts(connection: Connection, base: PublicKey, quote: PublicKey, commitment: Commitment) {
    const accounts = await connection.getProgramAccounts(
        raydium,
        {
            commitment,
            filters: [
                { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
                {
                    memcmp: {
                        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
                        bytes: base.toBase58(),
                    },
                },
                {
                    memcmp: {
                        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
                        bytes: quote.toBase58(),
                    },
                },
            ],
        }
    );

    return accounts.map(({ pubkey, account }) => ({
        id: pubkey.toString(),
        ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
    }));
}

/**
 * Performs a token swap on the Raydium protocol.
 * Depending on the configuration, it can execute the swap or simulate it.
 */
const swap = async (swapConfig) => {
    /**
     * The RaydiumSwap instance for handling swaps.
     */
    const raydiumSwap = new RaydiumSwap(process.env.RPC_URL, process.env.WALLET_PRIVATE_KEY);
    console.log(`Raydium swap initialized`);
    console.log(`Swapping ${swapConfig.tokenAAmount} of ${swapConfig.tokenAAddress} for ${swapConfig.tokenBAddress}...`)

    /**
     * Load pool keys from the Raydium API to enable finding pool information.
     */
    await raydiumSwap.loadPoolKeys(swapConfig.liquidityFile);
    console.log(`Loaded pool keys`);

    /**
     * Find pool information for the given token pair.
     */
    const poolInfo = raydiumSwap.findPoolInfoForTokens(swapConfig.tokenAAddress, swapConfig.tokenBAddress);
    console.log('Found pool info');

    /**
     * Prepare the swap transaction with the given parameters.
     */
    const tx = await raydiumSwap.getSwapTransaction(
        swapConfig.tokenBAddress,
        swapConfig.tokenAAmount,
        poolInfo,
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
            ? await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction, swapConfig.maxRetries)
            : await raydiumSwap.sendLegacyTransaction(tx as Transaction, swapConfig.maxRetries);

        console.log(`https://solscan.io/tx/${txid}`);

    } else {
        /**
         * Simulate the transaction and log the result.
         */
        const simRes = swapConfig.useVersionedTransaction
            ? await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction)
            : await raydiumSwap.simulateLegacyTransaction(tx as Transaction);

        console.log(simRes);
    }
};


// Monitor logs
async function main(connection: Connection, programAddress: PublicKey) {
    // const tokenAAccount = new PublicKey("4bkQwKjGQfnMgGooWoDcZ1fHwkBddjTCMJMCNuS8JwYy")
    // const tokenBAccount = new PublicKey("So11111111111111111111111111111111111111112")


    // await fetchMarketAccounts(connection, tokenAAccount, tokenBAccount, 'confirmed').then((keyPair) => {
    //     console.log("Market Accounts Found");
    //     console.log(keyPair);
    // });
    // process.exit(0);

    console.log("Monitoring logs for program:", programAddress.toString());
    connection.onLogs(
        programAddress,
        async ({ logs, err, signature }) => {
            if (err) return;
            //console.log(logs[0]);

            /*
            for (let log of logs) {
                if (log.includes("InitializeAccount")) {
                    console.log("Signature for 'InitializeAccount':", signature);
                }
            }
            */
            if (logs && logs.length > 0) {
                console.log("new log", new Date());
                if (logs.some(log => log.includes("initialize2"))) {
                    console.log("Signature for 'initialize2':", signature);
                    const tokens = await fetchRaydiumAccounts(signature, connection);
                    console.log("Token A Account:", tokens.tokenAAccount.toBase58());
                    console.log("Token B Account:", tokens.tokenBAccount.toBase58());

                    const tokensAddresses = {
                        tokenAAccount: tokens.tokenAAccount.toBase58(),
                        tokenBAccount: tokens.tokenBAccount.toBase58()
                    }

                    const thread = new Worker('./src/worker.js', {
                        workerData: {
                            tokens,
                        }
                    })

                    thread.on('message', (message) => {

                        if (message.event == 'exit') {
                            thread.terminate()
                        } else if (message.event == 'error') {
                            thread.terminate()

                        } else if (message.event == 'expired') {
                            thread.terminate()


                        } else if (message.event == 'completed') {
                            thread.terminate()


                        } else if (message.event == 'update') {

                        }
                    })

                    console.log("Worker started");
                    //console.log(thread)

                    //const keyPair = await fetchMarketAccounts(connection, tokens.tokenAAccount, tokens.tokenBAccount, 'confirmed')


                    // process.exit(0);

                    /*
 await fetchRaydiumAccounts(signature, connection).then(async (tokens) => {
                        const tokenAAccount = tokens.tokenAAccount;
                        const tokenBAccount = tokens.tokenBAccount;
                        console.log("Token A Account:", tokenAAccount.toBase58());
                        console.log("Token B Account:", tokenBAccount.toBase58());

                        const keyPair = await fetchMarketAccounts(connection, tokenAAccount, tokenBAccount, 'confirmed')
                        console.log("Market Accounts Found");
                        console.log(keyPair);

                        process.exit(0);
                    })
                    */
                }
            }
        },
        "finalized"
    );
}

// Parse transaction and filter data
async function fetchRaydiumAccounts(txId: string, connection: Connection) {
    const tx = await connection.getParsedTransaction(
        txId,
        {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

    credits += 100;

    //const accounts = tx?.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY).accounts;
    const txInstructions: PartiallyDecodedInstruction | ParsedInstruction = tx?.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY)
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
        { "Token": "B", "Account Public Key": tokenBAccount.toBase58() }
    ];
    console.log("New LP Found");
    console.log(generateExplorerUrl(txId));
    console.table(displayData);
    console.log("Total QuickNode Credits Used in this session:", credits);

    return { tokenAAccount, tokenBAccount };
}

function generateExplorerUrl(txId) {
    return `https://solscan.io/tx/${txId}`;
}

main(connection, raydium).catch(console.error);