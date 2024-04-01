import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const keyArray = [88,92,82,178,132,97,161,143,51,208,246,118,247,208,1,136,96,67,25,39,95,8,180,15,66,36,85,126,139,94,246,239,165,212,68,18,167,69,187,111,13,7,243,71,19,213,88,170,123,229,0,64,65,223,53,44,35,57,84,155,218,63,22,44];
  const secretKey = keyArray.slice(0, 32);
  const publicKey = keyArray.slice(32, 64);

  const sk = bs58.encode(Buffer.from(secretKey));
  const pk = bs58.encode(Buffer.from(publicKey));

  console.log("Public Key:", pk);
  console.log("Secret Key:", sk);