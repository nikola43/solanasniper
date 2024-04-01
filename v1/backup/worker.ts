const { parentPort, workerData } = require('worker_threads')
const fs = require('fs');
//import RaydiumSwap from './RaydiumSwap';
import RaydiumSwap from './RaydiumSwap';
require('dotenv').config()
import { Transaction, VersionedTransaction, PublicKey, Connection } from '@solana/web3.js';

// import {
//     LIQUIDITY_STATE_LAYOUT_V4,
//     MARKET_STATE_LAYOUT_V3,
// } from "@raydium-io/raydium-sdk";

const { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3 } = require("@raydium-io/raydium-sdk");

//const { Connection, PublicKey, VersionedTransaction, Transaction } = require("@solana/web3.js");

const RAYDIUM_PUBLIC_KEY = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

const raydium = new PublicKey(RAYDIUM_PUBLIC_KEY);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// Define a function to fetch and decode OpenBook accounts
async function fetchOpenBookAccounts(connection, baseMint, quoteMint, commitment) {
    const accounts = await connection.getProgramAccounts(
        raydium,
        {
            commitment,
            filters: [
                { dataSize: MARKET_STATE_LAYOUT_V3.span },
                {
                    memcmp: {
                        offset: MARKET_STATE_LAYOUT_V3.offsetOf("baseMint"),
                        bytes: baseMint.toBase58(),
                    },
                },
                {
                    memcmp: {
                        offset: MARKET_STATE_LAYOUT_V3.offsetOf("quoteMint"),
                        bytes: quoteMint.toBase58(),
                    },
                },
            ],
        }
    );

    return accounts.map(({ account }) => MARKET_STATE_LAYOUT_V3.decode(account.data));
}

// Define a function to fetch and decode Market accounts
async function fetchMarketAccounts(connection, base, quote, commitment) {
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

    // return accounts.map(({ pubkey, account }) => ({
    //     id: pubkey.toString(),
    //     ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
    // }));

    return accounts.map(({ pubkey, account }) => ({
        id: pubkey,
        ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
    }));
}
const SESSION_HASH = 'QNDEMO' + Math.ceil(Math.random() * 1e9); // Random unique identifier for your session
const connection = new Connection(`https://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/`, {
    wsEndpoint: `wss://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/`,
    httpHeaders: { "x-session-hash": SESSION_HASH }
});

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
    const poolInfo2 = swapConfig.poolInfo;
    console.log('Found pool info');
    console.log("poolInfo");
    console.log({
        poolInfo,
        poolInfo2
    });

    /**
     * Prepare the swap transaction with the given parameters.
     */
    const tx = await raydiumSwap.getSwapTransaction(
        swapConfig.tokenBAddress,
        swapConfig.tokenAAmount,
        poolInfo2,
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

let success = false;
let retry = 0;
let maxRetry = 5;





(async () => {

    const baseMint = new PublicKey("xc7sCtusyg9omL5n1NW3nWcSb8Jq2c91oM4rnzd24z1");
    const quoteMint = new PublicKey("So11111111111111111111111111111111111111112");
    

    const keyPair = await fetchMarketAccounts(connection, baseMint, quoteMint, 'confirmed').then((keyPair) => {
        console.log(keyPair);
        return keyPair
    })
    //keyPair[0].id

    console.log("keyPair", keyPair[0]);
    keyPair[0].programId = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
    keyPair[0].baseDecimals = Number(keyPair[0].baseDecimal.toString())
    keyPair[0].quoteDecimals = Number(keyPair[0].quoteDecimal.toString())
    keyPair[0].lpDecimals = 8
    keyPair[0].version = 4

    const swapConfig = {
        executeSwap: false, // Send tx when true, simulate tx when false
        useVersionedTransaction: true,
        tokenAAmount: 0.0056, // Swap 0.01 SOL for USDT in this example
        tokenAAddress: "So11111111111111111111111111111111111111112", // Token to swap for the other, SOL in this case
        tokenBAddress: "xc7sCtusyg9omL5n1NW3nWcSb8Jq2c91oM4rnzd24z1", // USDC address
        maxLamports: 1500000, // Micro lamports for priority fee
        direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
        //liquidityFile: "https://api.raydium.io/v2/sdk/liquidity/mainnet.json",
        liquidityFile: "./mainnet.json",
        maxRetries: 20,
        poolInfo: keyPair[0]
    };

    swap(swapConfig);


})();

// (async () => {
//     while (!success && retry < maxRetry) {
//         try {
//             const { tokensAddresses } = workerData
//             console.log("tokensAddresses", tokensAddresses);
//             fs.writeFileSync("tokensAddresses.json", JSON.stringify(tokensAddresses, null, 2));
//             const baseMint = new PublicKey(tokensAddresses.tokenAAccount);
//             const quoteMint = new PublicKey(tokensAddresses.tokenBAccount);
//             const keyPair = await fetchMarketAccounts(connection, baseMint, quoteMint, 'confirmed').then((keyPair) => {
//                 console.log(keyPair);
//                 return keyPair
//             })
//             fs.writeFileSync("data.json", JSON.stringify(keyPair, null, 2));
//             success = true;


//             const swapConfig = {
//                 executeSwap: false, // Send tx when true, simulate tx when false
//                 useVersionedTransaction: true,
//                 tokenAAmount: 0.0056, // Swap 0.01 SOL for USDT in this example
//                 tokenAAddress: tokensAddresses.tokenAAccount, // Token to swap for the other, SOL in this case
//                 tokenBAddress: tokensAddresses.tokenBAccount, // USDC address
//                 maxLamports: 1500000, // Micro lamports for priority fee
//                 direction: "in", // Swap direction: 'in' or 'out'
//                 //liquidityFile: "https://api.raydium.io/v2/sdk/liquidity/mainnet.json",
//                 liquidityFile: "./mainnet.json",
//                 maxRetries: 20,
//             };



//         } catch (error) {
//             console.log("e", error.message);
//             fs.writeFileSync("error.json", error.message);
//             retry++;
//             success = false;
//         }
//         if (!success) {
//             await sleep(5000).then(() => {
//                 console.log("sleeping");
//             });
//         }
//     }
// })();



/*
while (!failed) {
    

    sleep(5000).then(() => {
        console.log("sleeping");
    });
}

*/


