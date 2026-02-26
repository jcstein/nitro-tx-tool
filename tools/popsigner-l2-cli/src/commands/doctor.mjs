import {
  assertHttpRpcUrl,
  maybeEnv,
  mustEnv,
  rpc
} from "../lib/common.mjs";

export async function runDoctor(args) {
  const l1RpcUrl = args["l1-rpc-url"] || maybeEnv("L1_RPC_URL");
  const l2RpcUrl = args["l2-rpc-url"] || maybeEnv("L2_RPC_URL");
  const popsignerRpcUrl = args["popsigner-rpc-url"] || mustEnv("POPSIGNER_RPC_URL");
  const from = args.from || mustEnv("POPSIGNER_FROM");
  const authToken = args["api-key"] || maybeEnv("POPSIGNER_API_KEY");
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  assertHttpRpcUrl("POPSIGNER_RPC_URL", popsignerRpcUrl);
  if (l1RpcUrl) assertHttpRpcUrl("L1_RPC_URL", l1RpcUrl);
  if (l2RpcUrl) assertHttpRpcUrl("L2_RPC_URL", l2RpcUrl);

  console.log("== doctor ==");
  console.log(`from=${from}`);

  if (l1RpcUrl) {
    const [cid, bal] = await Promise.all([
      rpc(l1RpcUrl, "eth_chainId", []),
      rpc(l1RpcUrl, "eth_getBalance", [from, "latest"])
    ]);
    console.log(`l1_chain_id=${BigInt(cid).toString()}`);
    console.log(`l1_balance_wei=${BigInt(bal).toString()}`);
  } else {
    console.log("l1=skipped (L1_RPC_URL unset)");
  }

  if (l2RpcUrl) {
    const [cid, bal] = await Promise.all([
      rpc(l2RpcUrl, "eth_chainId", []),
      rpc(l2RpcUrl, "eth_getBalance", [from, "latest"])
    ]);
    console.log(`l2_chain_id=${BigInt(cid).toString()}`);
    console.log(`l2_balance_wei=${BigInt(bal).toString()}`);
  } else {
    console.log("l2=skipped (L2_RPC_URL unset)");
  }

  try {
    const psCid = await rpc(popsignerRpcUrl, "eth_chainId", [], headers);
    console.log(`popsigner_chain_id=${BigInt(psCid).toString()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Method not found")) {
      throw err;
    }
    // Some signer RPCs don't expose eth_chainId. Check basic liveness with web3_clientVersion.
    const clientVersion = await rpc(popsignerRpcUrl, "web3_clientVersion", [], headers);
    console.log(`popsigner_chain_id=unsupported`);
    console.log(`popsigner_client=${clientVersion}`);
  }
}
