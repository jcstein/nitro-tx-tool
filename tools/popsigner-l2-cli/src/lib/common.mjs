export function usage() {
  return [
    "popsigner-l2 <command> [flags]",
    "",
    "Commands:",
    "  doctor   Check RPC and balances",
    "  bridge   Send L1 Inbox depositEth() tx",
    "  pulse    Send periodic L2 self-transfers",
    "",
    "Common env:",
    "  POPSIGNER_RPC_URL, POPSIGNER_API_KEY, POPSIGNER_FROM",
    "  L1_RPC_URL, L2_RPC_URL, INBOX_ADDRESS"
  ].join("\n");
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const keyVal = token.slice(2).split("=");
    const key = keyVal[0];
    if (keyVal.length > 1) {
      out[key] = keyVal.slice(1).join("=");
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

export function mustEnv(name, fallback = "") {
  const val = process.env[name] ?? fallback;
  if (!val) throw new Error(`missing required env var: ${name}`);
  return val;
}

export function maybeEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function assertHttpRpcUrl(name, value) {
  const s = String(value).toLowerCase();
  if (s.startsWith("http://") || s.startsWith("https://")) return;
  throw new Error(`${name} must be http(s) JSON-RPC URL (got ${value})`);
}

export function toHex(v) {
  return "0x" + v.toString(16);
}

export function parseMs(input) {
  const text = String(input).trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d+)(ms|s|m)$/);
  if (!match) throw new Error(`invalid duration: ${input}`);
  const n = Number(match[1]);
  if (match[2] === "ms") return n;
  if (match[2] === "s") return n * 1000;
  return n * 60 * 1000;
}

export function parseEthToWeiHex(ethText) {
  const text = String(ethText).trim();
  const [whole, frac = ""] = text.split(".");
  const wholeWei = BigInt(whole || "0") * 1_000_000_000_000_000_000n;
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  const fracWei = BigInt(fracPadded || "0");
  return toHex(wholeWei + fracWei);
}

export function gweiToWeiHex(gweiText) {
  const text = String(gweiText).trim();
  const [whole, frac = ""] = text.split(".");
  const wholeWei = BigInt(whole || "0") * 1_000_000_000n;
  const fracPadded = (frac + "000000000").slice(0, 9);
  const fracWei = BigInt(fracPadded || "0");
  return toHex(wholeWei + fracWei);
}

export async function rpc(url, method, params, headers = {}) {
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
    const code = json.error.code ?? "unknown";
    const msg = json.error.message ?? "unknown RPC error";
    throw new Error(`${method} RPC ${code}: ${msg}`);
  }
  return json.result;
}

export function getRawSignedTx(signResult) {
  if (typeof signResult === "string" && signResult.startsWith("0x")) return signResult;
  if (signResult && typeof signResult.raw === "string" && signResult.raw.startsWith("0x")) {
    return signResult.raw;
  }
  throw new Error(`unexpected eth_signTransaction result: ${JSON.stringify(signResult)}`);
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
