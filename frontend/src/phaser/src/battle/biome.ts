export enum BIOME_ID {
    grasslands = 0,
    desert = 1,
    tundra = 2,
    cave = 3,
}

export function biomeToBackground(id: BIOME_ID): string {
    switch (id) {
        case BIOME_ID.grasslands:
            return 'bg-grass';
        case BIOME_ID.desert:
            return 'bg-desert';
        case BIOME_ID.tundra:
            return 'bg-tundra';
        case BIOME_ID.cave:
            return 'bg-cave';
    }
}

export function biomeToName(id: BIOME_ID): string {
    switch (id) {
        case BIOME_ID.grasslands:
            return 'Grasslands';
        case BIOME_ID.desert:
            return 'Scorched Desert';
        case BIOME_ID.tundra:
            return 'Frozen Tundra';
        case BIOME_ID.cave:
            return 'Goblin Caves';
    }
}