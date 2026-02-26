#!/usr/bin/env node

import { runDoctor } from "../src/commands/doctor.mjs";
import { runBridge } from "../src/commands/bridge.mjs";
import { runPulse } from "../src/commands/pulse.mjs";
import { parseArgs, usage } from "../src/lib/common.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(usage());
    return;
  }

  if (cmd === "doctor") {
    await runDoctor(args);
    return;
  }
  if (cmd === "bridge") {
    await runBridge(args);
    return;
  }
  if (cmd === "pulse") {
    await runPulse(args);
    return;
  }

  throw new Error(`unknown command: ${cmd}\n\n${usage()}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
