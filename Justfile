set dotenv-load := true

network := "testnet"
deployer := "plink-deployer"
usdc_sac := "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
wasm := "target/wasm32v1-none/release/plink.wasm"

default:
    @just --list

# ---------------------------------------------------------------- contract

# Run contract unit tests
test:
    cargo test -p plink

# Build the contract wasm
build-contract:
    stellar contract build

# Deploy a fresh contract to testnet (prints the new contract id)
deploy-contract: build-contract
    stellar contract deploy --wasm {{wasm}} --source-account {{deployer}} --network {{network}} --alias plink \
      -- --admin {{deployer}} --token {{usdc_sac}}

# Invoke any contract function, e.g. `just invoke get_pool --id 1`
invoke *ARGS:
    stellar contract invoke --id plink --source-account {{deployer}} --network {{network}} -- {{ARGS}}

# ---------------------------------------------------------------- frontend

# Install all JS deps
install:
    pnpm install

# Run the frontend dev server on the portman port
dev:
    cd frontend && pnpm dev --port $(portman get plink/frontend)

# Typecheck + build the frontend
build-frontend:
    cd frontend && pnpm build
