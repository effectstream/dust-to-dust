# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dust 2 Dust is a singleplayer fully on-chain deck-building dungeon-crawler game built on the Midnight Network. Players collect spirit abilities, battle enemies in turn-based combat, and progress through biome-based dungeons with boss encounters. All game logic runs on-chain using zero-knowledge proofs via the Compact language.

## Repository Structure

The repo is split into **frontend/** (Yarn/Node workspace) and **backend/** (Deno workspace).

### Frontend (`frontend/`)

Yarn 4.1.0 workspace with Turbo build orchestration. Four packages under `src/`:

- **`src/contract/`** — Receiving copy of compiled contract artifacts. **Do not edit contract logic here** — it is overwritten by the backend compact command. Contains `index.ts`, `witnesses.ts`, `constants.ts`, and `managed/` (auto-copied).
- **`src/api/`** — `Game2API` class providing TypeScript interface to the contract. Uses RxJS observables for reactive state synchronization.
- **`src/content/`** — Game content definitions (`register.ts` with levels, enemies, bosses, abilities). Used by both phaser (boot scene) and backend admin scripts.
- **`src/phaser/`** — Phaser 3 game frontend with Vite bundler. 10 scenes (Boot → Battle → Shop → Quest etc.). Includes `mockapi.ts` for in-memory testing without blockchain.

Frontend packages are imported by their npm package names (Yarn workspace resolution):
```typescript
import { Game2API } from 'game2-api';           // src/api
import { pureCircuits, witnesses } from 'game2-contract';  // src/contract
```

### Backend (`backend/`)

Deno workspace with three packages under `packages/`:

- **`packages/midnight/`** — Contract source of truth + deploy/admin scripts
  - `contract-game2/` — Compact contract source (`template.compact` → `generate.js` → `game2.compact`). The `compact` script compiles and copies artifacts to `frontend/src/contract/`.
  - `contract-game2-deploy.ts` — Contract deployment CLI (Node/commander-based)
  - `contract-game2-admin.ts` — Admin CLI (content registration, join, info, clear)
- **`packages/node/`** — Paima runtime node (stub)
- **`packages/batcher/`** — Batcher service (stub)

## Build & Development Commands

```bash
# --- Contract compilation (must be done first when contract changes) ---
cd backend/packages/midnight/contract-game2
npm run compact    # Generates game2.compact, compiles, copies artifacts to frontend
npm run build      # TypeScript compilation + copy artifacts to dist/

# --- Frontend ---
cd frontend
yarn install
yarn build         # Build all frontend packages (turbo)
yarn test          # Run all tests
yarn lint          # Lint all packages

# Individual frontend package builds
cd frontend/src/phaser
npm run dev            # Dev server with hot reload
npm run build-mock     # Mock mode build (no blockchain needed)
npm run build-batcher  # Batcher mode build (production-like)
npm run preview        # Preview built game

# --- Run a single test ---
cd frontend/src/api
npx jest src/test/my-test.test.ts

# --- Backend deploy/admin ---
cd backend/packages/midnight
deno task contract-game2:deploy              # Deploy new contract
deno task contract-game2:admin register-content  # Register all game content
deno task contract-game2:admin register-content --minimal  # Minimal content for testing
deno task contract-game2:admin info          # Show deployment info
```

## Key Architecture Patterns

### State Flow: Contract → API → UI

`Game2API.state$` is an RxJS observable built with `combineLatest()` that merges public ledger state (from indexer GraphQL subscription) with private state (loaded once at startup). It uses `shareReplay({ bufferSize: 1, refCount: true })` to prevent duplicate subscriptions. The derived `Game2DerivedState` is a flattened, UI-friendly representation of the nested on-chain maps.

### Witness & Proving Flow

Witness functions (`src/contract/witnesses.ts`) are runtime adapters called during ZK proof generation. Key witnesses: `player_secret_key` (returns private key from private state) and `_divMod` (handles division/modulo for ZK constraints).

Proving runs in a Web Worker (`src/phaser/proving/prover-worker.ts`) using WASM. The worker loads prover keys, verifier keys, and ZK IR files from contract artifacts. If WASM proving fails, it falls back to an HTTP prover at localhost:6300. In batcher mode, proving is delegated to the batcher service instead.

### MockAPI (`src/phaser/mockapi.ts`)

Implements the full `DeployedGame2API` interface in-memory without blockchain/proving. Uses `BehaviorSubject` for state emissions. Simulates combat rounds via `combat_round_logic()`, deck index rotation, quest timing, and boss completion tracking. Has configurable delay (500ms default) to simulate network latency.

### Content Registration

Enemy/boss definitions in `src/content/register.ts` → converted to contract types via `configToEnemyStats()` → registered on-chain via `api.admin_level_*()` calls. The same `registerStartingContent()` function is used by both the Phaser boot scene and the backend admin CLI.

## Contract Code Generation

The contract uses a code generation pipeline because Compact's ZK circuit constraints make repetitive combat calculations impossible to write with loops. `generate.js` reads `template.compact`, replaces placeholder strings (e.g., `INSERT_PLAYER_DAMAGE_CODE_HERE`) with generated arithmetic expressions, and writes `game2.compact`. **Never edit `game2.compact` directly — always edit `template.compact`.**

The generator unrolls combinatorial combat paths (3 abilities × 3 enemies = 9 damage paths) into literal arithmetic since Compact cannot use loops in ZK circuits.

The backend `compact` script also copies the compiled `managed/` directory and `game2.compact` to `frontend/src/contract/src/` so the frontend can use the contract artifacts.

## Contract State Model

Key on-chain ledger maps:
- `players`: pub key → Player (gold, RNG seed)
- `all_abilities` / `player_abilities`: ability definitions and per-player ability inventories
- `active_battle_states` / `active_battle_configs`: current combat state and configuration
- `quests`: active quest configurations with timing
- `player_boss_progress`: biome → difficulty → completed (boss tracking)
- `levels` / `bosses`: random encounter configs and boss configs per biome/difficulty

Key provable circuits: `register_new_player`, `start_new_battle`, `combat_round`, `retreat_from_battle`, `start_new_quest`, `is_quest_ready`, `finalize_quest`, `sell_ability`, `upgrade_ability`, `admin_*`.

## Phaser Build Modes

Controlled via Vite modes and `.env` files in `frontend/src/phaser/`:
- **mock** — In-memory contract simulation, no blockchain. Best for UI development.
- **batcher-undeployed** — Connects to batcher service + indexer for production-like testing.
- **testnet** — Full testnet deployment with ZK proofs.

Key env vars: `VITE_API_FORCE_DEPLOY`, `VITE_CONTRACT_ADDRESS`, `VITE_BATCHER_MODE_ENABLED`, `VITE_SKIP_BATTLE_ANIMATIONS`.

## Testing & Linting

- **Test framework**: Jest 29 with `ts-jest/presets/default-esm`, 90-second timeout per test. Test files match `**/*.test.ts`.
- **Frontend linting**: ESLint with `standard-with-typescript` + Prettier. Many `no-unsafe-*` rules relaxed to warn (needed for Compact/ZK type boundaries).
- **Backend linting**: Deno built-in linter with excluded rules: `no-this-alias`, `require-yield`, `no-explicit-any`, `ban-types`, `no-unused-vars`, `no-slow-types`.

## Critical Data (Do Not Delete)

- `midnight-level-db/` — LevelDB private state. **Unrecoverable if lost.**
- `~/.midnight-dust-to-dust/deployment.json` — Contract address and deployment metadata.

## On-Chain Infrastructure Requirements

For non-mock development: running Midnight node, batcher service (https://github.com/PaimaStudios/midnight-batcher), indexer (port 8088), and prover server (port 6300).
