set dotenv-load := true

network := "testnet"
deployer := "plink-deployer"
usdc_sac := "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
wasm := "target/wasm32v1-none/release/plink.wasm"
port := "10013"

default:
    @just --list

# ---------------------------------------------------------------- contract

# Run contract unit tests
test:
    cargo test -p plink

# Build the contract wasm
build-contract:
    stellar contract build

# Deploy a fresh contract to testnet, then regenerate bindings
deploy-contract: build-contract
    stellar contract deploy --wasm {{wasm}} --source-account {{deployer}} --network {{network}} --alias plink \
      -- --admin {{deployer}} --token {{usdc_sac}}
    @echo "Now update deployments/testnet.json contractId and run: just bindings"

# Regenerate the TypeScript client from the deployed contract
bindings:
    stellar contract bindings typescript --contract-id plink --network {{network}} --output-dir /tmp/plink-bindings --overwrite
    cp /tmp/plink-bindings/src/index.ts frontend/src/contract-client.ts
    @echo "Re-apply the type-only import trim at the top of frontend/src/contract-client.ts"

# Invoke any contract function, e.g. `just invoke get_pool --id 1`
invoke *ARGS:
    stellar contract invoke --id plink --source-account {{deployer}} --network {{network}} -- {{ARGS}}

# ---------------------------------------------------------------- app

# Install all JS deps
install:
    pnpm install

# Run the frontend dev server on http://localhost:10013
dev:
    cd frontend && pnpm dev --port {{port}} --strictPort

# Typecheck + build frontend and server
build:
    pnpm build

# Run the production server locally against the built frontend
serve: build
    PORT={{port}} PUBLIC_URL=http://localhost:{{port}} node server/dist/index.js

# ---------------------------------------------------------------- demo

# Seed demo pools on testnet (pass --creator-secret S... to make your browser account the organizer)
seed *ARGS:
    cd frontend && pnpm tsx scripts/seed.mts {{ARGS}}

# Print anchor transactions + balances for a seeded persona (ayse|mert|zeynep|creator)
persona who="ayse":
    cd frontend && pnpm tsx scripts/anchor-status.mts {{who}}

# ---------------------------------------------------------------- docker

# Build and start the production container (uses .env for PUBLIC_URL / PLINK_PORT)
up:
    docker compose up -d --build

down:
    docker compose down

logs:
    docker compose logs -f --tail=100

# Fund an account with test USDC through the anchor in ≤₺3000 chunks, e.g. `just fund plink-deployer 200`
fund who="plink-deployer" usd="60":
    cd frontend && pnpm tsx scripts/fund.mts {{who}} {{usd}}

# Stage a refund demo without the anchor: `just expire 6 zeynep` contributes Zeynep's USDC to pool 6 and expires it
expire id who="" usd="":
    cd frontend && pnpm tsx scripts/expire.mts {{id}} {{who}} {{usd}}
