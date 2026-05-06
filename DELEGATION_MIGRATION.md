# Delegation Migration: Store Full Shielded Address (64 bytes)

**Status:** spec only — DO NOT implement yet. Execute when ready.

## Goal

Replace the current `Map<Field, Field>` delegation storage with `Map<Field, ShieldedAddressData>` holding the **full 64-byte raw shielded address** (`coin_pub_key ‖ enc_pub_key`). This removes the 31-byte truncation, makes the backend display the real `mn_shield-addr_<network>1...` that matches the user's wallet, and eliminates the `mn_dust`-vs-`mn_shield-cpk` mismatch between frontend and backend.

## Why "Option A" (raw bytes) not "Option B" (bech32m string)

- Raw 64 bytes fit `Bytes<64>` — precedent exists (`Player.rng: Bytes<32>` in `template.compact:282`).
- No padding/length tracking needed.
- Backend bech32m-encodes on read, frontend bech32m-decodes on write — both already have `@scure/base`.
- Smaller on-chain footprint (64 bytes vs ~150 bytes for the string).

## Environment facts

- **Contract:** `backend/packages/midnight/contract-game2/src/template.compact` → `game2.compact` (generated)
- **Contract currently deployed at:** `7c2227d08d5e4a3843ec1a23fc9cab8b537ec4b44ef1156280d6a330d3ee20f6` (undeployed network) — **will be abandoned**
- **State machine:** `backend/packages/node/main.ts` + `backend/packages/node/game-db.ts`
- **DB:** `postgres` database on `localhost:5432`, schema `public`, table `d2d_delegations`
- **Frontend API:** `frontend/src/api/src/index.ts`
- **Frontend wallet link UI:** `frontend/src/phaser/src/menus/main.ts`
- **Frontend boot (leaderboard address exposure):** `frontend/src/phaser/src/menus/boot.ts`
- **Frontend bech32 utils:** `frontend/src/phaser/src/bech32-utils.ts`

Existing delegations in `d2d_delegations` are all garbage/test data and can be wiped.

## Implementation steps

### Step 1 — Contract (`template.compact`)

**Current (line 911):**
```compact
export ledger delegations: Map<Field, Field>;
```

**New:**
```compact
export struct ShieldedAddressData {
    data: Bytes<64>,
}

export ledger delegations: Map<Field, ShieldedAddressData>;
```

**Current (lines 944-947):**
```compact
export circuit register_delegation(wallet_address: Field): [] {
    const my_key = derive_player_pub_key(disclose(player_secret_key()));
    delegations.insert(my_key, disclose(wallet_address));
}
```

**New:**
```compact
export circuit register_delegation(wallet_address: Bytes<64>): [] {
    const my_key = derive_player_pub_key(disclose(player_secret_key()));
    delegations.insert(my_key, disclose(ShieldedAddressData { data: wallet_address }));
}
```

Then recompile:
```bash
cd backend/packages/midnight/contract-game2
npm run compact      # regenerates game2.compact + copies artifacts to frontend/src/contract/
npm run build
```

### Step 2 — Frontend API (`frontend/src/api/src/index.ts`)

**Interface (line 172):**
```typescript
// old
registerDelegation: (walletAddress: bigint) => Promise<void>;
// new
registerDelegation: (walletAddress: Uint8Array) => Promise<void>;
```

**Implementation (lines 498-502):**
```typescript
// new
async registerDelegation(walletAddress: Uint8Array): Promise<void> {
    if (walletAddress.length !== 64) {
        throw new Error(`registerDelegation: expected 64 bytes, got ${walletAddress.length}`);
    }
    this.logger?.info(`registerDelegation(len=${walletAddress.length})`);
    await (this.deployedContract.callTx as any).register_delegation(walletAddress);
    this.logger?.info('registerDelegation done');
}
```

**Derived state `myDelegatedAddress` (lines 294-299):** the map value is now a struct; extract `.data` and return a `Uint8Array`.
```typescript
// new
const myDelegatedAddress: Uint8Array | null =
    playerId !== null && ledgerAny.delegations?.member(playerId)
        ? ledgerAny.delegations.lookup(playerId).data
        : null;
```

**Type in `common-types.ts:79`:**
```typescript
// old: myDelegatedAddress: bigint | null;
myDelegatedAddress: Uint8Array | null;
```

Also check `src/phaser/src/mockapi.ts` (`mockState.myDelegatedAddress`) and `src/api/src/test/game-flow.test.ts` for type updates.

### Step 3 — Frontend bech32 utils (`frontend/src/phaser/src/bech32-utils.ts`)

Add:
```typescript
/** Encode raw 64 bytes as mn_shield-addr bech32m (coin_pk || enc_pk). */
export function toBech32mShieldAddr(data: Uint8Array, networkId: string): string {
    const suffix = networkId === 'mainnet' ? '' : `_${networkId}`;
    return bech32m.encode(`mn_shield-addr${suffix}`, bech32m.toWords(data), false);
}
```

`decodeBech32mBytes()` already exists from prior work.

### Step 4 — Frontend wallet link (`frontend/src/phaser/src/menus/main.ts`)

Replace the coin-pub-key truncation logic with bech32m decoding of the full shielded address.

```typescript
const addresses = await connected.getShieldedAddresses();
const shieldedAddrStr = addresses.shieldedAddress;
if (!shieldedAddrStr || !shieldedAddrStr.startsWith('mn_shield-addr')) {
    logger.network.warn(`[wallet-delegation] Unexpected shieldedAddress: ${shieldedAddrStr}`);
    return;
}
const addressBytes = decodeBech32mBytes(shieldedAddrStr);
if (addressBytes.length !== 64) {
    logger.network.warn(`[wallet-delegation] Expected 64 bytes, got ${addressBytes.length}`);
    return;
}

const fromLabel = localPublicKey != null
    ? shortBech32(toBech32mDust(localPublicKey, networkId))
    : 'your game account';
const walletLabel = shortBech32(shieldedAddrStr);

if (overlay) overlay.remove();
txSpinner.show("Generating Proof");

await api.registerDelegation(addressBytes);

localStorage.setItem('d2d-linked-wallet-addr', shieldedAddrStr);
(window as any).__d2dWalletAddress = shieldedAddrStr;

txSpinner.hide();
// ...success content unchanged
```

Delete the old hex/Bech32m/Uint8Array conversion block, the 31-byte truncation, and the `addressBigint` construction.

### Step 5 — Frontend boot (`frontend/src/phaser/src/menus/boot.ts`)

The reconstruction fallback is no longer needed — the on-chain bytes are already the full 64 bytes.

```typescript
// old (lines 205-219): read Uint8Array, pad to 32, shield-cpk encode
// new:
if (state.myDelegatedAddress) {
    (window as any).__d2dWalletAddress = toBech32mShieldAddr(state.myDelegatedAddress, networkId);
}
```

The `localStorage` path can be dropped (or kept as a no-op backup). Remove `decodeBech32mBytes` / padding helpers that are no longer needed from this file.

### Step 6 — Backend state machine (`backend/packages/node/game-db.ts`)

**6a. Add encoder (near line 49, next to `toBech32mDust`):**
```typescript
/** Encode 64 raw bytes as mn_shield-addr bech32m. */
export function bytesToBech32Shield(data: Uint8Array): string {
    const suffix = networkId === 'mainnet' ? '' : `_${networkId}`;
    return bech32m.encode(`mn_shield-addr${suffix}`, bech32m.toWords(data), false);
}
```

**6b. Update `extractMaps` (around lines 634-714, specifically line 703/712 where `maps[10]` = delegations):**

The ledger map value is now a struct `ShieldedAddressData { data: Bytes<64> }` instead of a raw `Field`. The payload shape from the indexer will change. After recompiling the contract, log `maps[10]` on first run to confirm the exact shape. Expected shape options:
- `{ data: Uint8Array(64) }` (most likely — Compact struct mapping)
- `{ data: { bytes: Uint8Array } }` (if serialization wraps)
- A tagged cell (`{ value: { data: ... } }`)

Adjust the extraction to produce `Map<hexKey, Uint8Array>` where the `Uint8Array` is the 64-byte address.

**6c. Update `syncDelegations` (lines 1809-1849):**
```typescript
for (const [fromAddr, toValue] of delegationsMap.entries()) {
    const fromBech32 = hexToBech32(fromAddr);
    const addrBytes = toValue instanceof Uint8Array
        ? toValue
        : new Uint8Array(toValue);  // defensive conversion
    if (addrBytes.length !== 64) {
        console.warn(`[syncDelegations] Expected 64 bytes for ${fromAddr}, got ${addrBytes.length}; skipping`);
        continue;
    }
    const toBech32 = bytesToBech32Shield(addrBytes);

    // existing upsert logic — unchanged:
    const existing = await db.query(
        `SELECT to_address FROM public.d2d_delegations WHERE from_address = $1`,
        [fromBech32]
    );
    if (existing.rows.length === 0 || existing.rows[0].to_address !== toBech32) {
        await db.query(
            `INSERT INTO public.d2d_delegations (from_address, to_address, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (from_address) DO UPDATE
             SET to_address = EXCLUDED.to_address, updated_at = now()`,
            [fromBech32, toBech32]
        );
    }
}
```

**6d. Leaderboard queries (lines ~1901, 1940, 1956)** — no query changes needed; they use `d2d_delegations` table only. Verify after deployment that `to_address` values are now `mn_shield-addr_...`.

### Step 7 — Database

Schema is unchanged (`to_address TEXT`), but existing rows hold garbage. Wipe before restarting the state machine:
```sql
-- psql -U postgres -h localhost -p 5432 -d postgres
TRUNCATE TABLE public.d2d_delegations;
```

### Step 8 — Contract redeployment

```bash
cd backend/packages/midnight
deno task contract-game2:deploy
deno task contract-game2:admin register-content        # or --minimal for testing
deno task contract-game2:admin info                    # confirm new address
```

Then update env files with the new contract address:
- `~/.midnight-dust-to-dust/deployment.json` — written automatically by deploy script
- `frontend/src/phaser/.env.undeployed` → `VITE_CONTRACT_ADDRESS=<new>`

Restart services:
1. Node state machine (`backend/packages/node/`)
2. Batcher service
3. Frontend dev build (`frontend/src/phaser` → `npm run build` or `npm run dev`)

## Testing checklist

- [ ] `npm run compact` succeeds; new `game2.compact` contains `ShieldedAddressData` struct
- [ ] `tsc --noEmit` passes in `frontend/src/phaser` and `frontend/src/api`
- [ ] Deno type-check passes in `backend/packages/node`
- [ ] New contract address appears in `deployment.json`
- [ ] Frontend: register new player, click "Link Wallet" — success popup shows `mn_shield-addr_undeployed1adze8vhmu0jhygau9alqnd20rravs4up3t75vef5y44glamlwyw48d2yryqhwm2azkpw3ynly8j2zkh7qc87q2wflscnch0ua6hdlkgsxclge` (matching the wallet browser's address exactly, including the last 6 chars)
- [ ] Leaderboard popup after reload shows the same full `mn_shield-addr_...`
- [ ] DB check:
  ```sql
  SELECT from_address, to_address FROM public.d2d_delegations;
  ```
  `to_address` entries are `mn_shield-addr_undeployed1...` (148 chars) matching the wallet
- [ ] State machine logs show no parse errors from `extractMaps` / `syncDelegations`

## Related cleanup (separate PR, not blocking)

- `frontend/src/phaser/index.html:495` — leaderboard row match uses `myAddr = walletAddr || playerAddr`, but leaderboard entries are keyed by **game account** (`from_address`). Row highlight won't work. Change to `myAddr = playerAddr` OR have the backend join via `d2d_delegations` so leaderboard entries display wallet addresses.
- `frontend/src/phaser/src/bech32-utils.ts:scaleCompactEncode` / `toBech32mShieldCpk` — still used for the game-account `mn_dust` display. Keep.
- `frontend/src/phaser/src/menus/boot.ts` — once verified, remove the `d2d-linked-wallet-addr` localStorage fallback read.

## Rollback plan

1. `git revert` the frontend + backend + contract changes
2. `cd backend/packages/midnight/contract-game2 && npm run compact` (regenerates old `game2.compact`)
3. Redeploy the old contract
4. Update env files back to old contract address
5. `TRUNCATE public.d2d_delegations;`
6. Restart services

## Open questions to resolve during implementation

1. **Exact shape of `maps[10]` after contract change** — confirm via runtime log on first deploy (struct wrapping may differ). Step 6b depends on this.
2. **Mock API (`mockapi.ts`)** — currently stores `myDelegatedAddress` as `bigint`. Need to update to `Uint8Array` and generate a plausible 64-byte mock value.
3. **Existing frontend tests** (`frontend/src/api/src/test/game-flow.test.ts`) — the `PLAYER_ID` / delegation test fixtures will need type updates.
4. **Admin CLI** (`backend/packages/midnight/contract-game2-admin.ts`) — verify nothing there references the old delegation signature.
