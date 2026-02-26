#!/usr/bin/env node

function mustEnv(name, fallback = "") {
  const val = process.env[name] ?? fallback;
  if (!val) {
    throw new Error(`missing required env var: ${name}`);
  }
  return val;
}

function parseMs(input) {
  const text = String(input).trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  const match = text.match(/^(\d+)(ms|s|m)$/);
  if (!match) {
    throw new Error(`invalid interval format: ${input}`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "ms") return value;
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  throw new Error(`unsupported interval unit: ${unit}`);
}

function toHex(n) {
  return "0x" + n.toString(16);
}

function gweiToWeiHex(gweiText) {
  const text = String(gweiText).trim();
  const [whole, frac = ""] = text.split(".");
  const wholeWei = BigInt(whole || "0") * 1_000_000_000n;
  const fracPadded = (frac + "000000000").slice(0, 9);
  const fracWei = BigInt(fracPadded || "0");
  return toHex(wholeWei + fracWei);
}

async function rpc(url, method, params, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params
      })
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
    const code = json.error.code ?? "unknown";
    const msg = json.error.message ?? "unknown RPC error";
    throw new Error(`${method} RPC ${code}: ${msg}`);
  }
  return json.result;
}

function getRawSignedTx(signResult) {
  if (typeof signResult === "string" && signResult.startsWith("0x")) {
    return signResult;
  }
  if (signResult && typeof signResult.raw === "string" && signResult.raw.startsWith("0x")) {
    return signResult.raw;
  }
  throw new Error(`unexpected eth_signTransaction result: ${JSON.stringify(signResult)}`);
}

async function buildUnsignedTx(l2RpcUrl, from, to, nonce, priorityFeeHex, headers) {
  const [chainIdHex, baseFeeBlock] = await Promise.all([
    rpc(l2RpcUrl, "eth_chainId", [], headers),
    rpc(l2RpcUrl, "eth_getBlockByNumber", ["latest", false], headers)
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

  // Nitro chains can require higher intrinsic gas than plain 21k.
  const estimatedGasHex = await rpc(l2RpcUrl, "eth_estimateGas", [tx], headers);
  const estimatedGas = BigInt(estimatedGasHex);
  tx.gas = toHex((estimatedGas * 12n) / 10n); // +20% headroom

  return tx;
}

async function main() {
  const l2RpcUrl = mustEnv("L2_RPC_URL");
  const popsignerRpcUrl = mustEnv("POPSIGNER_RPC_URL");
  const from = mustEnv("POPSIGNER_FROM");
  const to = process.env.POPSIGNER_TO || from;
  const intervalMs = parseMs(process.env.HEARTBEAT_INTERVAL || "2s");
  const priorityFeeHex = gweiToWeiHex(process.env.MAX_PRIORITY_FEE_GWEI || "0.01");
  const maxRuns = Number(process.env.MAX_RUNS || "0");
  const authToken = process.env.POPSIGNER_API_KEY || "";

  const popsignerHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  console.log("starting heartbeat sender");
  console.log(`from=${from} to=${to} interval=${intervalMs}ms popsigner=${popsignerRpcUrl}`);

  let runs = 0;
  while (true) {
    try {
      const nonceHex = await rpc(l2RpcUrl, "eth_getTransactionCount", [from, "pending"]);
      const nonce = BigInt(nonceHex);
      const tx = await buildUnsignedTx(l2RpcUrl, from, to, nonce, priorityFeeHex, {});

      const signResult = await rpc(
        popsignerRpcUrl,
        "eth_signTransaction",
        [tx],
        popsignerHeaders
      );
      const raw = getRawSignedTx(signResult);
      const txHash = await rpc(l2RpcUrl, "eth_sendRawTransaction", [raw], {});

      runs += 1;
      console.log(`[${new Date().toISOString()}] sent heartbeat tx #${runs}: ${txHash}`);
      if (maxRuns > 0 && runs >= maxRuns) {
        console.log(`MAX_RUNS=${maxRuns} reached, exiting`);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] heartbeat error: ${msg}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
