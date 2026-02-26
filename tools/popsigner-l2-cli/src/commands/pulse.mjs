import {
  assertHttpRpcUrl,
  getRawSignedTx,
  gweiToWeiHex,
  maybeEnv,
  mustEnv,
  parseMs,
  rpc,
  sleep,
  toHex
} from "../lib/common.mjs";

async function buildUnsignedL2Tx(l2RpcUrl, from, to, nonce, priorityFeeHex) {
  const [chainIdHex, baseFeeBlock] = await Promise.all([
    rpc(l2RpcUrl, "eth_chainId", []),
    rpc(l2RpcUrl, "eth_getBlockByNumber", ["latest", false])
  ]);

  const chainId = BigInt(chainIdHex);
  const baseFee = BigInt(baseFeeBlock?.baseFeePerGas ?? "0x0");
  const maxPriorityFee = BigInt(priorityFeeHex);
  const maxFee = baseFee * 2n + maxPriorityFee;

  const tx = {
    from,
    to,
    value: "0x0",
    data: "0x",
    nonce: toHex(nonce),
    chainId: toHex(chainId),
    maxPriorityFeePerGas: toHex(maxPriorityFee),
    maxFeePerGas: toHex(maxFee),
    type: "0x2"
  };

  const estimatedGasHex = await rpc(l2RpcUrl, "eth_estimateGas", [tx]);
  const estimatedGas = BigInt(estimatedGasHex);
  tx.gas = toHex((estimatedGas * 12n) / 10n);
  return tx;
}

export async function runPulse(args) {
  const l2RpcUrl = args["l2-rpc-url"] || mustEnv("L2_RPC_URL");
  const popsignerRpcUrl = args["popsigner-rpc-url"] || mustEnv("POPSIGNER_RPC_URL");
  const from = args.from || mustEnv("POPSIGNER_FROM");
  const to = args.to || maybeEnv("POPSIGNER_TO", from);
  const intervalMs = parseMs(args.interval || maybeEnv("HEARTBEAT_INTERVAL", "2s"));
  const priorityFeeHex = gweiToWeiHex(args["priority-fee-gwei"] || maybeEnv("MAX_PRIORITY_FEE_GWEI", "0.01"));
  const maxRuns = Number(args["max-runs"] || maybeEnv("MAX_RUNS", "0"));
  const authToken = args["api-key"] || maybeEnv("POPSIGNER_API_KEY");
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  assertHttpRpcUrl("L2_RPC_URL", l2RpcUrl);
  assertHttpRpcUrl("POPSIGNER_RPC_URL", popsignerRpcUrl);

  console.log("starting pulse sender");
  console.log(`from=${from} to=${to} interval=${intervalMs}ms popsigner=${popsignerRpcUrl}`);

  let runs = 0;
  while (true) {
    try {
      const nonceHex = await rpc(l2RpcUrl, "eth_getTransactionCount", [from, "pending"]);
      const nonce = BigInt(nonceHex);
      const tx = await buildUnsignedL2Tx(l2RpcUrl, from, to, nonce, priorityFeeHex);
      const signResult = await rpc(popsignerRpcUrl, "eth_signTransaction", [tx], headers);
      const raw = getRawSignedTx(signResult);
      const txHash = await rpc(l2RpcUrl, "eth_sendRawTransaction", [raw]);

      runs += 1;
      console.log(`[${new Date().toISOString()}] sent tx #${runs}: ${txHash}`);
      if (maxRuns > 0 && runs >= maxRuns) {
        console.log(`MAX_RUNS=${maxRuns} reached, exiting`);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] pulse error: ${msg}`);
    }

    await sleep(intervalMs);
  }
}
