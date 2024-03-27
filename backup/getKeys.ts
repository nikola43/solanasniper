import {
    LIQUIDITY_STATE_LAYOUT_V4,
    MARKET_STATE_LAYOUT_V3,
} from "@raydium-io/raydium-sdk";

const { Connection, PublicKey } = require("@solana/web3.js");

const RAYDIUM_PUBLIC_KEY = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

const raydium = new PublicKey(RAYDIUM_PUBLIC_KEY);


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

    return accounts.map(({ pubkey, account }) => ({
        id: pubkey.toString(),
        ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
    }));
}
const SESSION_HASH = 'QNDEMO' + Math.ceil(Math.random() * 1e9); // Random unique identifier for your session
const connection = new Connection(`https://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/`, {
    wsEndpoint: `wss://broken-wispy-borough.solana-mainnet.quiknode.pro/7c1eeffbf6f3531067b2a0fafdc673d5edc23e73/`,
    httpHeaders: { "x-session-hash": SESSION_HASH }
});

async function main() {
    const baseMint = new PublicKey("F5H3t4NiySX7DjzkoMsFmJCnKn1rNfpAqzwL3Db9CKmb");
    const quoteMint = new PublicKey("So11111111111111111111111111111111111111112");
    const keyPair = await fetchMarketAccounts(connection, baseMint, quoteMint, 'confirmed');
    console.log(keyPair);

}

main().then(() => console.log("Done."));