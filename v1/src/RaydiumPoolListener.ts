import { LIQUIDITY_STATE_LAYOUT_V4, LiquidityPoolKeysV4, LiquidityStateV4, LiquidityPoolKeys, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Market, TOKEN_PROGRAM_ID, Token, TokenAmount } from "@raydium-io/raydium-sdk";
import { Connection, Logs, ParsedInnerInstruction, ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import RaydiumSwap from './RaydiumSwap';
let RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
import mysql from 'mysql';




export interface MinimalTokenAccountData {
    mint: PublicKey;
    address: PublicKey;
    poolKeys?: LiquidityPoolKeys;
    market?: MinimalMarketLayoutV3;
}

export const RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = MAINNET_PROGRAM_ID.AmmV4;
const runTimestamp = Math.floor(new Date().getTime() / 1000);
export const OPENBOOK_PROGRAM_ID = MAINNET_PROGRAM_ID.OPENBOOK_MARKET;
const RAYDIUM_POOL_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
require('dotenv').config()
import { logger } from './utils';
import bs58 from "bs58";
import { MinimalMarketLayoutV3, getMinimalMarketV3 } from "./market";
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


const pool = mysql.createPool({
    host: process.env.mysql_host ?? 'localhost',
    user: process.env.mysql_user ?? 'root',
    password: process.env.mysql_password ?? '',
    database: process.env.mysql_database ?? 'solanaSniper',
    connectionLimit: 50,
    debug: false
})

pool.getConnection((err, connection) => {
    if (err)
        throw err
    if (connection)
        connection.release()
})





let quoteMinPoolSizeAmount: TokenAmount;
let quoteToken = Token.WSOL;
quoteMinPoolSizeAmount = new TokenAmount(quoteToken, 2, false);
const existingLiquidityPools: Set<string> = new Set<string>();

export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {

    const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);
    const quoteMint = poolState.quoteMint
    const baseMint = poolState.baseMint

    //const tokenMetadata = await getTokenMetadata(baseMint, connection)
    //logger.info(`Processing pool: ${id.toString()} with ${poolSize.toFixed()} ${quoteToken.symbol} in liquidity`);
    //logger.info(`Token: ${tokenMetadata.symbol}  ${baseMint.toBase58()}`);

    const query = `INSERT INTO pools (poolId, baseMint, quoteMint) VALUES ('${id.toBase58()}', '${poolState.baseMint.toBase58()}', '${poolState.quoteMint.toBase58()}')`
    console.log(query);
    const result = await pool.query(query);
   // logger.info(result);
}

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

subscribeToNewRaydiumPools();


