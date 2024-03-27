export const swapConfig = {
  executeSwap: false, // Send tx when true, simulate tx when false
  useVersionedTransaction: true,
  tokenAAmount: 0.01, // Swap 0.01 SOL for USDT in this example
  tokenAAddress: "So11111111111111111111111111111111111111112", // Token to swap for the other, SOL in this case
  tokenBAddress: "xc7sCtusyg9omL5n1NW3nWcSb8Jq2c91oM4rnzd24z1", // USDC address
  maxLamports: 1500000, // Micro lamports for priority fee
  direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
  //liquidityFile: "https://api.raydium.io/v2/sdk/liquidity/mainnet.json",
  liquidityFile: "./mainnet.json",
  maxRetries: 20,
};
