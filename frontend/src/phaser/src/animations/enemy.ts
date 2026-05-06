/**
 * Enemy animation definitions and creation functions
 */

// Animation timing constants
export const ENEMY_ANIMATION_DURATIONS = {
    idle: 1200,
    attack: 1200,
    hurt: 400,
    death: 1500
};

export enum SPRITE_SHEET_ENEMIES {
    GOBLIN = 'goblin',
    PYRAMID = 'pyramid',
    FIRE_SPRITE = 'fire-sprite',
    COYOTE = 'coyote',
    SNOWMAN = 'snowman',
    GOBLIN_PRIEST = 'goblin-priest',
    GOBLIN_SWORDMASTER = 'goblin-swordmaster',
    TENTACLE = 'tentacle',
    
    MINIBOSS_HELLSPAWN = 'hellspawn',
    MINIBOSS_ICE_GOLEM = 'ice-golem',
    MINIBOSS_GOBLIN_CHIEF = 'miniboss-goblin-chief',
    MINIBOSS_TENTACLES = 'miniboss-tentacles',

    BOSS_DRAGON = 'boss-dragon',
    BOSS_ENIGMA = 'boss-enigma',
    BOSS_ABOMINABLE = 'boss-abominable',
    BOSS_SPHINX = 'boss-sphinx',
}

// Configuration for enemy frame counts
const ENEMY_FRAME_CONFIG: Record<string, { idleFrames: number; attackFrames: number[] }> = {
    [SPRITE_SHEET_ENEMIES.GOBLIN]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.SNOWMAN]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.FIRE_SPRITE]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.COYOTE]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.PYRAMID]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.GOBLIN_PRIEST]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.GOBLIN_SWORDMASTER]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.TENTACLE]: { idleFrames: 4, attackFrames: [5, 6, 5] },

    [SPRITE_SHEET_ENEMIES.MINIBOSS_ICE_GOLEM]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.MINIBOSS_HELLSPAWN]: { idleFrames: 2, attackFrames: [2] },
    [SPRITE_SHEET_ENEMIES.MINIBOSS_GOBLIN_CHIEF]: { idleFrames: 3, attackFrames: [3] },
    [SPRITE_SHEET_ENEMIES.MINIBOSS_TENTACLES]: { idleFrames: 4, attackFrames: [5, 6, 5] },

    [SPRITE_SHEET_ENEMIES.BOSS_DRAGON]: { idleFrames: 6, attackFrames: [6, 7] },
    [SPRITE_SHEET_ENEMIES.BOSS_ENIGMA]: { idleFrames: 6, attackFrames: [6, 7, 8, 8, 9, 6] },
    [SPRITE_SHEET_ENEMIES.BOSS_ABOMINABLE]: { idleFrames: 5, attackFrames: [5, 6, 7, 7, 8, 9, 10, 11, 11, 11] },
    [SPRITE_SHEET_ENEMIES.BOSS_SPHINX]: { idleFrames: 2, attackFrames: [2] },
};

const defaultFameConfig = { idleFrames: 2 };

export function createEnemyAnimations(scene: Phaser.Scene): void {
    // Check if animations already exist to avoid duplicate warnings
    const firstEnemyType = Object.values(SPRITE_SHEET_ENEMIES)[0];
    if (scene.anims.exists(`${firstEnemyType}-idle`)) {
        return; // Animations already created
    }
    
    // Enemies with 2-frame sprite sheets
    const spriteSheetEnemies = Object.values(SPRITE_SHEET_ENEMIES);
    
    for (const enemyType of spriteSheetEnemies) {
        const textureKey = `enemy-${enemyType}`;
        
        // Only create animations if the texture exists
        if (!scene.textures.exists(textureKey)) {
            continue;
        }

        // Create idle animation with configurable frame count
        const frameConfig = ENEMY_FRAME_CONFIG[enemyType] || defaultFameConfig;
        const idleFrames = Array.from({ length: frameConfig.idleFrames }, (_, i) => i);

        scene.anims.create({
            key: `${enemyType}-idle`,
            frames: idleFrames.map((i) => { return { frame: i, key: textureKey }; }),
            repeat: -1,
            duration: ENEMY_ANIMATION_DURATIONS.idle
        });

        // Create attack animation
        scene.anims.create({
            key: `${enemyType}-attack`, 
            frames: frameConfig.attackFrames.map((i) => { return { frame: i, key: textureKey }; }),
            repeat: 0,
            duration: ENEMY_ANIMATION_DURATIONS.attack
        });

        // Create hurt animation (quick flash between frames)
        scene.anims.create({
            key: `${enemyType}-hurt`,
            frames: [1, 0].map((i) => { return { frame: i, key: textureKey }; }),
            repeat: 0, 
            duration: ENEMY_ANIMATION_DURATIONS.hurt
        });

        // Create death animation (fade to second frame)
        scene.anims.create({
            key: `${enemyType}-death`,
            frames: [{ frame: 1, key: textureKey }],
            repeat: 0,
            duration: ENEMY_ANIMATION_DURATIONS.death
        });
    }
    
    // Single-frame boss enemies (fallback to static animations)
    const singleFrameEnemies = [''];
    
    for (const enemyType of singleFrameEnemies) {
        const baseName = enemyType.replace(/-1$/, '');
        const textureKey = `enemy-${enemyType}`;
        
        // Only create animations if the texture exists
        if (!scene.textures.exists(textureKey)) {
            continue;
        }

        // Create idle animation (single frame)
        scene.anims.create({
            key: `${baseName}-idle`,
            frames: [{ frame: 0, key: textureKey }],
            repeat: -1,
            duration: ENEMY_ANIMATION_DURATIONS.idle
        });

        // Create attack animation (single frame)
        scene.anims.create({
            key: `${baseName}-attack`, 
            frames: [{ frame: 2, key: textureKey }],
            repeat: 0,
            duration: ENEMY_ANIMATION_DURATIONS.attack
        });

        // Create hurt animation (single frame)
        scene.anims.create({
            key: `${baseName}-hurt`,
            frames: [{ frame: 0, key: textureKey }],
            repeat: 0, 
            duration: ENEMY_ANIMATION_DURATIONS.hurt
        });

        // Create death animation (single frame)
        scene.anims.create({
            key: `${baseName}-death`,
            frames: [{ frame: 0, key: textureKey }],
            repeat: 0,
            duration: ENEMY_ANIMATION_DURATIONS.death
        });
    }
}
