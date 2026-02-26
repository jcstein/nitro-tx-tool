# popsigner-l2-cli

Small CLI for PopSigner-powered Orbit workflows:

- bridge L1 ETH to L2 via Inbox `depositEth()`
- pulse L2 self-transfers to force block production
- run doctor checks for RPC + balances

## Setup

```bash
cd tools/popsigner-l2-cli
cp .env.example .env
# edit .env
set -a; source .env; set +a
```

## Fill `.env`

Start from `.env.example`:

```dotenv
L1_RPC_URL=https://sepolia.infura.io/v3/REPLACE_WITH_REAL_KEY
L2_RPC_URL=http://127.0.0.1:8547
POPSIGNER_RPC_URL=https://rpc.popsigner.com
POPSIGNER_API_KEY=REPLACE_WITH_POPSIGNER_API_KEY
POPSIGNER_FROM=0xREPLACE_WITH_POPSIGNER_EVM_ADDRESS
POPSIGNER_TO=0xREPLACE_WITH_RECIPIENT_OR_SAME_AS_FROM
INBOX_ADDRESS=0xREPLACE_WITH_ORBIT_INBOX_ADDRESS
DEPOSIT_ETH=0.001
HEARTBEAT_INTERVAL=250ms
MAX_PRIORITY_FEE_GWEI=0.01
MAX_RUNS=0
```

Where values come from:

- `L1_RPC_URL`: your Sepolia provider HTTP(S) endpoint (Infura/Alchemy/QuickNode). This CLI expects HTTP(S), not WSS.
- `L2_RPC_URL`: Nitro RPC endpoint from bundle `docker-compose.yaml` (`http://127.0.0.1:8547` by default).
- `POPSIGNER_RPC_URL`: PopSigner RPC endpoint (`https://rpc.popsigner.com`).
- `POPSIGNER_API_KEY`: PopSigner dashboard API key (integration credential).
- `POPSIGNER_FROM`: EVM address of your PopSigner key; usually same as bundle `BATCH_POSTER_ADDRESS` or `STAKER_ADDRESS`.
- `POPSIGNER_TO`: recipient for `pulse`; set same as `POPSIGNER_FROM` for self-transfer spam.
- `INBOX_ADDRESS`: Orbit inbox address from bundle `config/core-contracts.json` (`inbox`) or `config/chain-info.json` (`.[0].rollup.inbox`).
- `DEPOSIT_ETH`: amount sent by `bridge` per run.
- `HEARTBEAT_INTERVAL`: send interval for `pulse` (e.g. `250ms`, `1s`).
- `MAX_PRIORITY_FEE_GWEI`: EIP-1559 tip value.
- `MAX_RUNS`: `0` for infinite loop, else stop after N txs.

Quick extraction examples from this bundle:

```bash
# from tools/popsigner-l2-cli
jq -r '.inbox' ../../config/core-contracts.json
jq -r '.[0].rollup.inbox' ../../config/chain-info.json
rg '^BATCH_POSTER_ADDRESS=|^STAKER_ADDRESS=' ../../.env
```

Quick validation:

```bash
set -a; source .env; set +a
node ./bin/popsigner-l2.mjs doctor
```

## Commands

```bash
# sanity check
node ./bin/popsigner-l2.mjs doctor

# bridge 0.001 ETH from L1 to L2
node ./bin/popsigner-l2.mjs bridge --eth 0.001 --wait-for-l2-credit

# spam L2 self-txs
node ./bin/popsigner-l2.mjs pulse --interval 250ms --max-runs 0
```

## Publish As Own Repo

```bash
cd tools/popsigner-l2-cli
git init
git add .
git commit -m "feat: popsigner l2 bridge and pulse cli"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```
