import {
  assertHttpRpcUrl,
  getRawSignedTx,
  gweiToWeiHex,
  maybeEnv,
  mustEnv,
  parseEthToWeiHex,
  parseMs,
  rpc,
  sleep,
  toHex
} from "../lib/common.mjs";

const DEPOSIT_ETH_SELECTOR = "0x439370b1";

export async function runBridge(args) {
  const l1RpcUrl = args["l1-rpc-url"] || mustEnv("L1_RPC_URL");
  const l2RpcUrl = args["l2-rpc-url"] || maybeEnv("L2_RPC_URL");
  const popsignerRpcUrl = args["popsigner-rpc-url"] || mustEnv("POPSIGNER_RPC_URL");
  const from = args.from || mustEnv("POPSIGNER_FROM");
  const inboxAddress =
    args.inbox || maybeEnv("INBOX_ADDRESS", "0x041B2F0983d3BFeE34d6EfD98D6B26e2A18C81C5");
  const depositEth = args.eth || maybeEnv("DEPOSIT_ETH", "0.001");
  const priorityFeeHex = gweiToWeiHex(args["priority-fee-gwei"] || maybeEnv("MAX_PRIORITY_FEE_GWEI", "0.1"));
  const authToken = args["api-key"] || maybeEnv("POPSIGNER_API_KEY");
  const waitForL2Credit = Boolean(args["wait-for-l2-credit"]);
  const waitTimeoutMs = parseMs(args["wait-timeout"] || "10m");
  const waitPollMs = parseMs(args["wait-poll"] || "5s");
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  assertHttpRpcUrl("L1_RPC_URL", l1RpcUrl);
  assertHttpRpcUrl("POPSIGNER_RPC_URL", popsignerRpcUrl);
  if (waitForL2Credit) {
    if (!l2RpcUrl) throw new Error("L2_RPC_URL is required with --wait-for-l2-credit");
    assertHttpRpcUrl("L2_RPC_URL", l2RpcUrl);
  }

  const valueHex = parseEthToWeiHex(depositEth);
  const l2BalanceBefore = l2RpcUrl ? BigInt(await rpc(l2RpcUrl, "eth_getBalance", [from, "latest"])) : null;

  const [nonceHex, chainIdHex, latestBlock] = await Promise.all([
    rpc(l1RpcUrl, "eth_getTransactionCount", [from, "pending"]),
    rpc(l1RpcUrl, "eth_chainId", []),
    rpc(l1RpcUrl, "eth_getBlockByNumber", ["latest", false])
  ]);

  const nonce = BigInt(nonceHex);
  const chainId = BigInt(chainIdHex);
  const baseFee = BigInt(latestBlock?.baseFeePerGas ?? "0x0");
  const maxPriorityFee = BigInt(priorityFeeHex);
  const maxFee = baseFee * 2n + maxPriorityFee;

  const tx = {
    from,
    to: inboxAddress,
    value: valueHex,
    data: DEPOSIT_ETH_SELECTOR,
    nonce: toHex(nonce),
    chainId: toHex(chainId),
    type: "0x2",
    maxPriorityFeePerGas: toHex(maxPriorityFee),
    maxFeePerGas: toHex(maxFee)
  };

  const gasHex = await rpc(l1RpcUrl, "eth_estimateGas", [tx]);
  tx.gas = gasHex;

  const signResult = await rpc(popsignerRpcUrl, "eth_signTransaction", [tx], headers);
  const raw = getRawSignedTx(signResult);
  const txHash = await rpc(l1RpcUrl, "eth_sendRawTransaction", [raw]);

  console.log("bridge tx sent");
  console.log(`tx_hash=${txHash}`);
  console.log(`from=${from}`);
  console.log(`inbox=${inboxAddress}`);
  console.log(`deposit_eth=${depositEth}`);

  if (!waitForL2Credit) return;

  const start = Date.now();
  while (Date.now() - start < waitTimeoutMs) {
    const balNow = BigInt(await rpc(l2RpcUrl, "eth_getBalance", [from, "latest"]));
    if (l2BalanceBefore === null || balNow > l2BalanceBefore) {
      console.log(`l2_credit_observed=true`);
      console.log(`l2_balance_wei=${balNow.toString()}`);
      return;
    }
    await sleep(waitPollMs);
  }

  throw new Error(
    `timed out waiting for L2 credit after ${waitTimeoutMs}ms; deposit tx may be pending or not yet consumed`
  );
}
