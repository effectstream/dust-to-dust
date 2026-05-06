/**
 * Spirit animation definitions and creation functions
 */

// Animation timing constants
export const SPIRIT_ANIMATION_DURATIONS = {
    spiritAuraIdle: 4500,
    spiritIdle: 650,
    orbAuraIdle: 1000,
    charge: 1000,
    spiritAttack: 1200
};

// Animation keys
export const spiritAuraIdleKey = 'spirit-aura-idle';
export const chargeAnimKey = 'charge';
export const orbAuraIdleKey = 'orb-aura';

export function createSpiritAnimations(scene: Phaser.Scene): void {
    // Check if animations already exist to avoid duplicate warnings
    if (scene.anims.exists(spiritAuraIdleKey)) {
        return; // Animations already created
    }
    
    scene.anims.create({
        key: spiritAuraIdleKey,
        frames: [0, 1, 2, 1, 2, 1, 0, 1, 0, 1].map((i) => { return { frame: i, key: 'spirit-aura' }; }),
        repeat: -1,
        duration: SPIRIT_ANIMATION_DURATIONS.spiritAuraIdle,
    });

    scene.anims.create({
        key: chargeAnimKey,
        frames: [0, 1, 2, 3, 5].map((i) => { return { frame: i, key: 'spirit-aura' }; }),
        repeat: 0,
        duration: SPIRIT_ANIMATION_DURATIONS.charge,
    });

    scene.anims.create({
        key: orbAuraIdleKey,
        frames: [0, 1, 2, 3].map((i) => { return { frame: i, key: orbAuraIdleKey }; }),
        repeat: -1,
        duration: SPIRIT_ANIMATION_DURATIONS.orbAuraIdle,
    });
    
    const affixes = ['atk-fire', 'atk-ice', 'atk-phys', 'def'];
    
    // Spirit idle
    for (const affix of affixes) {
        const key = `spirit-${affix}`;
        scene.anims.create({
            key,
            frames: [0, 1].map((i) => { return { frame: i, key }; }),
            repeat: -1,
            duration: SPIRIT_ANIMATION_DURATIONS.spiritIdle,
        });
    }
    
    // Spirit attack
    for (const affix of affixes) {
        const key = `spirit-${affix}`;
        scene.anims.create({
            key: `${key}-attack`,
            frames: [2, 3].map((i) => { return { frame: i, key }; }),
            repeat: 0,
            duration: SPIRIT_ANIMATION_DURATIONS.spiritAttack,
        });
    }
}