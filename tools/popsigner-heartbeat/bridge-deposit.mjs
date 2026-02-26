#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function mustEnv(name, fallback = "") {
  const val = process.env[name] ?? fallback;
  if (!val) {
    throw new Error(`missing required env var: ${name}`);
  }
  return val;
}

function assertHttpRpcUrl(name, value) {
  const lower = String(value).toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return;
  }
  if (lower.startsWith("ws://") || lower.startsWith("wss://")) {
    throw new Error(
      `${name} must be http(s) for this script (got ${value}). ` +
        `Use your provider HTTPS endpoint for eth_sendRawTransaction.`
    );
  }
  throw new Error(`${name} must be a valid http(s) JSON-RPC URL (got ${value})`);
}

function toHex(n) {
  return "0x" + n.toString(16);
}

function parseEthToWeiHex(ethText) {
  const text = String(ethText).trim();
  const [whole, frac = ""] = text.split(".");
  const wholeWei = BigInt(whole || "0") * 1_000_000_000_000_000_000n;
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  const fracWei = BigInt(fracPadded || "0");
  return toHex(wholeWei + fracWei);
}

function gweiToWeiHex(gweiText) {
  const text = String(gweiText).trim();
  const [whole, frac = ""] = text.split(".");
  const wholeWei = BigInt(whole || "0") * 1_000_000_000n;
  const fracPadded = (frac + "000000000").slice(0, 9);
  const fracWei = BigInt(fracPadded || "0");
  return toHex(wholeWei + fracWei);
}

function sig4(signature) {
  const out = execFileSync("cast", ["sig", signature], { encoding: "utf8" }).trim();
  if (!out.startsWith("0x") || out.length !== 10) {
    throw new Error(`unexpected selector from cast sig ${signature}: ${out}`);
  }
  return out;
}

async function rpc(url, method, params, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${method} network error at ${url}: ${detail}`);
  }
  if (!res.ok) {
    throw new Error(`${method} HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method} RPC ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

function getRawSignedTx(signResult) {
  if (typeof signResult === "string" && signResult.startsWith("0x")) return signResult;
  if (signResult && typeof signResult.raw === "string" && signResult.raw.startsWith("0x")) {
    return signResult.raw;
  }
  throw new Error(`unexpected eth_signTransaction result: ${JSON.stringify(signResult)}`);
}

async function main() {
  const l1RpcUrl = mustEnv("L1_RPC_URL");
  const popsignerRpcUrl = mustEnv("POPSIGNER_RPC_URL");
  const from = mustEnv("POPSIGNER_FROM");
  const inboxAddress = mustEnv("INBOX_ADDRESS", "0x041B2F0983d3BFeE34d6EfD98D6B26e2A18C81C5");
  const depositEth = mustEnv("DEPOSIT_ETH", "0.001");
  const priorityFeeHex = gweiToWeiHex(process.env.MAX_PRIORITY_FEE_GWEI || "0.1");
  const authToken = process.env.POPSIGNER_API_KEY || "";
  const popsignerHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  assertHttpRpcUrl("L1_RPC_URL", l1RpcUrl);
  assertHttpRpcUrl("POPSIGNER_RPC_URL", popsignerRpcUrl);

  const selector = sig4("depositEth()");
  const valueHex = parseEthToWeiHex(depositEth);

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
    data: selector,
    nonce: toHex(nonce),
    chainId: toHex(chainId),
    type: "0x2",
    maxPriorityFeePerGas: toHex(maxPriorityFee),
    maxFeePerGas: toHex(maxFee)
  };

  const gasHex = await rpc(l1RpcUrl, "eth_estimateGas", [tx]);
  tx.gas = gasHex;

  const signResult = await rpc(
    popsignerRpcUrl,
    "eth_signTransaction",
    [tx],
    popsignerHeaders
  );
  const raw = getRawSignedTx(signResult);
  const txHash = await rpc(l1RpcUrl, "eth_sendRawTransaction", [raw]);

  console.log("bridge tx sent");
  console.log(`tx_hash=${txHash}`);
  console.log(`from=${from}`);
  console.log(`inbox=${inboxAddress}`);
  console.log(`deposit_eth=${depositEth}`);
}

main().catch((err) => {
  if (err instanceof Error && err.cause) {
    console.error(`${err.message}\ncaused by: ${String(err.cause)}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
