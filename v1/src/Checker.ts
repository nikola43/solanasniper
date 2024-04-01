

import { set } from "@coral-xyz/anchor/dist/cjs/utils/features";
import { LIQUIDITY_STATE_LAYOUT_V4, Token, TokenAmount } from "@raydium-io/raydium-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

import mysql from 'mysql';
import { DataTypes, Sequelize } from "sequelize";
import { getTokenMetadata } from "./metadata";
require('dotenv').config()






const RAYDIUM_POOL_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

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
//let RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
const HTTP_RPC = "https://rpc.shyft.to?api_key=tbe9OcyS6qotgfHw";
let connection = new Connection(HTTP_RPC);



// Option 3: Passing parameters separately (other dialects)
const sequelize = new Sequelize('solanaSniper', 'root', '', {
    host: 'localhost',
    dialect: 'mysql'
});

const Pool = sequelize.define('Pool', {
    // Model attributes are defined here
    id: {
        type: DataTypes.NUMBER,
        allowNull: false,
        primaryKey: true
    },
    poolId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    baseMint: {
        type: DataTypes.STRING,
        allowNull: false
    },
    quoteMint: {
        type: DataTypes.STRING,
        allowNull: false
    },
    createdAt: {
        type: DataTypes.STRING,
        allowNull: false
    },
    updatedAt: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

const getAccountInfo = async (publicKey: PublicKey) => {
    return await connection.getAccountInfo(publicKey, COMMITMENT_LEVEL);
}

export async function checkPools() {
    const pools = await Pool.findAll();
    const tableData: any = [];


    for (let pool of pools) {
        //console.log(pool.toJSON())
        // @ts-ignore
        const poolId = new PublicKey(pool.dataValues.poolId);
        //console.log()
        //console.log(poolId)
        //const accountInfo = await getAccountInfo(poolId);
        const accountInfo = await connection.getMultipleAccountsInfo([poolId])
        const parsed = accountInfo.map((v) => LIQUIDITY_STATE_LAYOUT_V4.decode(v.data))
        const lpMint = parsed[0].lpMint
        const reserve = parsed[0].lpReserve
        const accInfo = await connection.getParsedAccountInfo(new PublicKey(lpMint));
        // @ts-ignore
        const mintInfo = accInfo?.value?.data?.parsed?.info
        //console.log(mintInfo)

        const lpReserve = reserve / Math.pow(10, mintInfo?.decimals)
        const actualSupply = mintInfo?.supply / Math.pow(10, mintInfo?.decimals)
        console.log(`lpMint: ${lpMint}, Reserve: ${lpReserve}, Actual Supply: ${actualSupply}`);

        //Calculate burn percentage
        const maxLpSupply = Math.max(actualSupply, (lpReserve - 1));
        const burnAmt = (lpReserve - actualSupply)
        // console.log(`burn amt: ${burnAmt}`)
        const burnPct = (burnAmt / lpReserve) * 100;
        // console.log(`${burnPct} LP burned`);

        console.log({
            poolId: pool.dataValues.poolId,
            tokenAddress: pool.dataValues.baseMint,
            lpMint: lpMint.toBase58(),
            poolSize: lpReserve,
            burned: burnAmt,
            burnedPct: burnPct,
            createdAt: pool.dataValues.createdAt,
            supply : mintInfo.supply
        })

        // const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
        // const poolSize = new TokenAmount(Token.WSOL, poolState.swapQuoteInAmount, true);
        // const quoteMint = poolState.quoteMint
        // const baseMint = poolState.baseMint
        // const tokenMetadata = await getTokenMetadata(baseMint, connection)
        // tableData.push({
        //     poolId: pool.dataValues.poolId,
        //     pair: `${tokenMetadata.symbol}/${Token.WSOL.symbol}`,
        //     poolSize: poolSize.toSignificant(6),
        //     poolSizeUSD: poolSize.toExact(),
        //     createdAt: pool.dataValues.createdAt
        // });

        // console.log(accountInfo)

    }
    //console.table(tableData);
}





// setInterval(() => {
//     checkPools().then(() => {
//         console.log('Checking pools...')
//     })
// }, 1000); // 5 minutes

checkPools().then(() => {
    console.log('Checking pools...')
})

