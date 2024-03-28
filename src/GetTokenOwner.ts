
// import { Connection, PublicKey } from '@solana/web3.js';

// async function getTokenAccountOwner(tokenAccountAddress: string) {
//     const connection = new Connection('https://api.mainnet-beta.solana.com');
//     const tokenAccountPublicKey = new PublicKey(tokenAccountAddress);
//     const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountPublicKey);

//     if (tokenAccountInfo.value) {
//         const tokenAccountData = tokenAccountInfo.value.data.parsed.info;
//         return tokenAccountData.owner;
//     }

//     return null;
// }

// getTokenAccountOwner()