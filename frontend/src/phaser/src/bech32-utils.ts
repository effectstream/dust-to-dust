/**
 * Bech32m address encoding utilities for Midnight Network.
 *
 * Midnight uses Bech32m addresses with prefix "mn_<type>[_<network>]":
 *   - mn_dust[_network]       — Dust (game account) public keys
 *   - mn_shield-cpk[_network] — Shielded coin public keys (wallet)
 */
import { bech32m } from '@scure/base';

/** SCALE compact-encode a bigint (variable-length integer encoding). */
export function scaleCompactEncode(value: bigint): Uint8Array {
    if (value < 64n) {
        return new Uint8Array([Number(value << 2n)]);
    } else if (value < 16384n) {
        const v = Number(value << 2n | 1n);
        return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
    } else if (value < (1n << 30n)) {
        const v = Number(value << 2n | 2n);
        return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
    } else {
        let v = value;
        const leBytes: number[] = [];
        while (v > 0n) {
            leBytes.push(Number(v & 0xffn));
            v >>= 8n;
        }
        const prefix = ((leBytes.length - 4) << 2) | 0b11;
        const result = new Uint8Array(1 + leBytes.length);
        result[0] = prefix;
        result.set(leBytes, 1);
        return result;
    }
}

/** Encode a bigint (Dust public key) to Bech32m mn_dust address. */
export function toBech32mDust(value: bigint, networkId: string): string {
    const data = scaleCompactEncode(value);
    const networkSuffix = networkId === 'mainnet' ? '' : `_${networkId}`;
    return bech32m.encode(`mn_dust${networkSuffix}`, bech32m.toWords(data), false);
}

/** Encode raw key bytes to Bech32m mn_shield-cpk address. */
export function toBech32mShieldCpk(keyBytes: Uint8Array, networkId: string): string {
    const networkSuffix = networkId === 'mainnet' ? '' : `_${networkId}`;
    return bech32m.encode(`mn_shield-cpk${networkSuffix}`, bech32m.toWords(keyBytes), false);
}

/** Encode 64 raw bytes (coin_pub_key || enc_pub_key) as Bech32m mn_shield-addr address. */
export function toBech32mShieldAddr(data: Uint8Array, networkId: string): string {
    const networkSuffix = networkId === 'mainnet' ? '' : `_${networkId}`;
    return bech32m.encode(`mn_shield-addr${networkSuffix}`, bech32m.toWords(data), false);
}

/** Decode a Bech32m address string to its raw data bytes. */
export function decodeBech32mBytes(address: string): Uint8Array {
    return new Uint8Array(bech32m.decodeToBytes(address).bytes);
}

/** Shorten a Bech32 address for display. */
export function shortBech32(addr: string): string {
    if (addr.length <= 30) return addr;
    return addr.slice(0, 18) + '...' + addr.slice(-8);
}
