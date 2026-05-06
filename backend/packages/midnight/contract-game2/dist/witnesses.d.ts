import { Ledger } from './managed/game2/contract/index.cjs';
import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
export type Game2PrivateState = {
    readonly secretKey: Uint8Array;
};
export declare const createGame2PrivateState: (secretKey: Uint8Array) => {
    secretKey: Uint8Array<ArrayBufferLike>;
};
export declare const witnesses: {
    player_secret_key: ({ privateState }: WitnessContext<Ledger, Game2PrivateState>) => [Game2PrivateState, Uint8Array];
    _divMod: (context: WitnessContext<Ledger, Game2PrivateState>, x: bigint, y: bigint) => [Game2PrivateState, [bigint, bigint]];
};
