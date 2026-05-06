# Midnight Game 2 — Dust 2 Dust

This project is built on the Midnight Network.

This is a singleplayer fully on-chain game written in Compact. It is a deck-building dungeon-crawler where you can gain new, stronger spirits to battle with, or level up your existing ones. Use these new, stronger spirits to complete quests against stronger and stronger boss enemies.

## Repository Structure

- **`frontend/`** — Yarn workspace with the browser app (Phaser 3) and supporting packages
  - `src/contract/` — Frontend copy of compiled contract artifacts (populated by backend compact)
  - `src/api/` — TypeScript API layer for contract interaction
  - `src/content/` — Game content definitions (levels, enemies, bosses)
  - `src/phaser/` — Phaser 3 game frontend
- **`backend/`** — Deno workspace with contract source, deployment, and server infrastructure
  - `packages/midnight/` — Contract source (template.compact), deploy & admin scripts
  - `packages/node/` — Paima runtime node (stub)
  - `packages/batcher/` — Batcher service (stub)

## Building

```bash
# 1. Compile the contract (backend — copies artifacts to frontend)
cd backend/packages/midnight/contract-game2
npm run compact
npm run build

# 2. Build the frontend
cd frontend
yarn install
yarn build

# 3. Deploy (requires batcher + indexer + prover)
cd backend/packages/midnight
deno task contract-game2:deploy

# 4. Register content
cd backend/packages/midnight
deno task contract-game2:admin register-content

# 5. Preview
cd frontend/src/phaser
npm run preview
```

Now the game will be available at `http://localhost:4173/`

To play on-chain you will need to run a node, proof server, and batcher, explained here: https://github.com/PaimaStudios/midnight-batcher

### CLI Contract Commands

- `deno task contract-game2:deploy` — Deploy a new contract using batcher
- `deno task contract-game2:deploy info` — Show current deployment info
- `deno task contract-game2:admin register-content` — Register all game content
- `deno task contract-game2:admin register-content --minimal` — Register minimal test content

See `backend/packages/midnight/` for more information on deploying and interacting with game contracts.
