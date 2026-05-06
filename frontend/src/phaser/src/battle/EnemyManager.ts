import { BattleConfig, BOSS_TYPE, EnemyStats, EFFECT_TYPE, BattleState } from "game2-contract";
import { addScaledImage, BASE_SPRITE_SCALE } from "../utils/scaleImage";
import { HealthBar } from "../widgets/progressBar";
import { fontStyle, GAME_WIDTH } from "../main";
import { BattleLayout } from "./BattleLayout";
import { Color, colorToNumber } from "../constants/colors";
import { Def } from "../constants/def";
import { BattleEffectType, effectTypeToIcon } from "../widgets/BattleEffect";

const ENEMY_TEXTURES = [
    'enemy-goblin',
    'enemy-fire-sprite',
    'enemy-snowman',
    'enemy-coyote',
    'enemy-pyramid',
    'enemy-ice-golem',
    'enemy-hellspawn',
    'enemy-goblin-priest',
    'enemy-goblin-swordmaster',
    'enemy-miniboss-goblin-chief',
    'enemy-miniboss-tentacles',
    'enemy-tentacle',
];

const BOSS_TEXTURES = [
    'enemy-boss-dragon',
    'enemy-boss-enigma',
    'enemy-boss-abominable',
    'enemy-boss-sphinx',
];

type AnimationType = 'idle' | 'attack' | 'hurt' | 'death';

class Plan extends Phaser.GameObjects.Container {
    constructor(actor: Actor, amount: number, effectType: BattleEffectType, allies: boolean) {
        super(actor.scene, /*actor.x*/ - actor.width / 2 - 32, /*actor.y + */actor.planYOffset());

        this.add(actor.scene.add.text(14, 0, amount.toString(), fontStyle(10)).setOrigin(0.5, 0.65));
        this.add(actor.scene.add.sprite(-14, 0, effectTypeToIcon(effectType)).setScale(BASE_SPRITE_SCALE));
        if (allies) {
            this.add(actor.scene.add.image(-14, -3, 'aoe').setScale(BASE_SPRITE_SCALE));
        }

        actor.scene.add.existing(this);
    }
}

export class Actor extends Phaser.GameObjects.Container {
    hp: number;
    maxHp: number;
    hpBar: HealthBar;
    block: number;
    image: Phaser.GameObjects.Image | undefined;
    sprite: Phaser.GameObjects.Sprite | undefined;
    animationTick: number;
    textureKey: string = '';
    stats: EnemyStats | null;
    planAttack: Plan | null;
    planBlockSelf: Plan | null;
    planBlockAllies: Plan | null;
    planHealSelf: Plan | null;
    planHealAllies: Plan | null;

    constructor(scene: Phaser.Scene, x: number, y: number, stats: EnemyStats | null) {
        super(scene, x, y);

        this.stats = stats;
        this.animationTick = Math.random() * 2 * Math.PI;

        let healtBarYOffset = 0;
        let healthbarWidth = 180;
        if (stats != null) {
            let texture = ENEMY_TEXTURES[Math.min(ENEMY_TEXTURES.length - 1, Number(stats.enemy_type))];
            if (stats.boss_type == BOSS_TYPE.boss) {
                texture = BOSS_TEXTURES[Math.min(BOSS_TEXTURES.length - 1, Number(stats.enemy_type))];
                healtBarYOffset = 80;  // Move healthbar for large enemies (bosses)
            }
            
            this.textureKey = texture;
            
            // Try to create animated sprite first, fallback to static image
            if (scene.anims.exists(this.getAnimationKey('idle'))) {
                this.sprite = scene.add.sprite(0, 0, texture);
                this.sprite.setScale(BASE_SPRITE_SCALE);
                this.sprite.anims.play(this.getAnimationKey('idle'));
                this.add(this.sprite);
                healtBarYOffset -= this.sprite.height * 1.5 + 22;
            } else {
                this.image = addScaledImage(scene, 0, 0, texture);
                healtBarYOffset -= this.image.height * 1.5 + 22;
                this.add(this.image);
            }
            switch (stats.boss_type) {
                case BOSS_TYPE.miniboss:
                    healthbarWidth = GAME_WIDTH * 0.5;
                    break;
                case BOSS_TYPE.boss:
                    healthbarWidth = GAME_WIDTH * 0.75;
                    break;
            }
            this.maxHp = Number(stats.hp);
        } else {
            // Player stats
            this.maxHp = 100;
            healthbarWidth = GAME_WIDTH * 0.5;
        }

        this.hp = this.maxHp;
        this.hpBar = new HealthBar({
            scene,
            x: 0,
            y: healtBarYOffset,
            width: healthbarWidth,
            height: 32,
            max: this.maxHp,
            displayTotalCompleted: true,
            transparent: stats != null, // Only make enemy healthbars transparent, not player
        });
        this.block = 0;

        this.add(this.hpBar);

        this.setHp(this.hp);
        this.setSize(64, 64);

        this.planAttack = null;
        this.planBlockSelf = null;
        this.planBlockAllies = null;
        this.planHealSelf = null;
        this.planHealAllies = null;

        scene.add.existing(this);
    }

    public setAttackPlan(amount: number) {
        this.planAttack?.destroy();
        this.planAttack = new Plan(this, amount, BattleEffectType.ATTACK_PHYS, false);
        this.add(this.planAttack);
    }

    public setBlockSelfPlan(amount: number) {
        this.planBlockSelf?.destroy();
        this.planBlockSelf = new Plan(this, amount, BattleEffectType.BLOCK, false);
        this.add(this.planBlockSelf);
    }

    public setBlockAlliesPlan(amount: number) {
        this.planBlockAllies?.destroy();
        this.planBlockAllies = new Plan(this, amount, BattleEffectType.BLOCK, true);
        this.add(this.planBlockAllies);
    }
    
    public setHealSelfPlan(amount: number) {
        this.planHealSelf?.destroy();
        this.planHealSelf = new Plan(this, amount, BattleEffectType.HEAL, false);
        this.add(this.planHealSelf);
    }

    public setHealAlliesPlan(amount: number) {
        this.planHealAllies?.destroy();
        this.planHealAllies = new Plan(this, amount, BattleEffectType.HEAL, true);
        this.add(this.planHealAllies);
    }

    public clearAttackPlan() {
        this.planAttack?.destroy();
        this.planAttack = null;
    }

    public clearBlockSelfPlan() {
        this.planBlockSelf?.destroy();
        this.planBlockSelf = null;
    }

    public clearBlockAlliesPlan() {
        this.planBlockAllies?.destroy();
        this.planBlockAllies = null;
    }

    public clearHealSelfPlan() {
        this.planHealSelf?.destroy();
        this.planHealSelf = null;
    }

    public clearHealAlliesPlan() {
        this.planHealAllies?.destroy();
        this.planHealAllies = null;
    }

    public planYOffset(): number {
        const total = (this.planAttack != null ? 1 : 0)
                    + (this.planBlockSelf != null ? 1 : 0)
                    + (this.planBlockAllies != null ? 1 : 0)
                    + (this.planHealSelf != null ? 1 : 0)
                    + (this.planHealAllies != null ? 1 : 0);
        return Math.floor((total + 1) / 2) * (total % 2 == 0 ? -32 : 32)
    }

    public addBlock(amount: number) {
        this.setBlock(this.block + amount);
    }

    public heal(amount: number) {
        this.setHp(Math.min(this.maxHp, this.hp + amount));
    }

    public damage(amount: number) {
        if (amount > this.block) {
            this.setHp(this.hp - amount + this.block);
            this.setBlock(0);
        } else {
            this.setBlock(this.block - amount);
        }
    }

    public endOfRound() {
        this.hpBar.finalizeTempProgress(() => {
            if (this.hp <= 0) {
                this.hpBar.setLabel('DEAD');
                this.dieAnimation();
            }
        });
    }

    private setHp(hp: number) {
        this.hp = Math.max(0, hp);
        this.hpBar.setValue(this.hp);
        if (this.hp <= 0) {
            this.image?.setAlpha(0.5);
            this.sprite?.setAlpha(0.5);
        }
    }

    public setBlock(block: number) {
        this.block = block;
        this.hpBar.setBlock(block);
    }

    public getDefenseAgainst(effectType: EFFECT_TYPE): Def {
        if (!this.stats) {
            return Def.NEUTRAL; // Default for player or enemies without stats
        }

        switch (effectType) {
            case EFFECT_TYPE.attack_fire:
                return Number(this.stats.fire_def) as Def;
            case EFFECT_TYPE.attack_ice:
                return Number(this.stats.ice_def) as Def;
            case EFFECT_TYPE.attack_phys:
                return Number(this.stats.physical_def) as Def;
            case EFFECT_TYPE.block:
            default:
                return Def.NEUTRAL;
        }
    }

    preUpdate() {
        // Add subtle breathing animation for living enemies
        if (this.hp > 0 && this.sprite) {
            this.animationTick += 0.005;
            const breathe = Math.sin(this.animationTick) * 2;
            this.sprite.setY(breathe);
        }
    }

    protected override preDestroy(): void {
        this.destroyPlans();
    }

    private destroyPlans() {
        this.clearAttackPlan();
        this.clearBlockSelfPlan();
        this.clearBlockAlliesPlan();
        this.clearHealSelfPlan();
        this.clearHealAlliesPlan();
    }

    private getAnimationKey(animationType: AnimationType): string {
        const baseName = this.textureKey.replace('enemy-', '').replace(/-1$/, '');
        return `${baseName}-${animationType}`;
    }

    public playAnimation(animationType: AnimationType): void {
        if (this.sprite) {
            const animKey = this.getAnimationKey(animationType);
            if (this.scene.anims.exists(animKey)) {
                this.sprite.anims.play(animKey);
            }
        }
    }

    public takeDamageAnimation(): Promise<void> {
        return new Promise((resolve) => {
            const target = this.sprite || this.image;
            if (!target) {
                resolve();
                return;
            }

            // Flash red and play hurt animation
            target.setTint(colorToNumber(Color.Red));
            this.playAnimation('hurt');

            // Scale effect for impact
            this.scene.tweens.add({
                targets: target,
                scaleX: target.scaleX * 1.1,
                scaleY: target.scaleY * 0.9,
                duration: 100,
                yoyo: true,
                onComplete: () => {
                    target.clearTint();
                    if (this.hp > 0) {
                        this.playAnimation('idle');
                    }
                    resolve();
                }
            });
        });
    }

    public castHealAnimation(): Promise<void> {
        return new Promise((resolve) => {
            const circle = this.scene.add.image(this.x, this.y, 'heal-effect-circle')
                .setAlpha(0)
                .setScale(0, 0);
            // Circle rotate
            this.scene.tweens.add({
                targets: circle,
                angle: 90,
                duration: 2400,
            });
            // Circle expand
            this.scene.tweens.add({
                targets: circle,
                alpha: 0.7,
                scaleX: 1,
                scaleY: 1,
                duration: 1000,
                onComplete: () => {
                    // Circle fade
                    this.scene.tweens.add({
                        targets: circle,
                        alpha: 0,
                        duration: 1500,
                        onComplete: () => circle.destroy(),
                    });
                    // Ray expand vertically
                    const rays = this.scene.add.image(this.x, this.y, 'heal-effect-rays')
                        .setAlpha(0)
                        .setOrigin(0.5, 64 / 92) // cirlce is 64 high, beam is 92, need origins to line up
                        .setScale(1, 0);
                    this.scene.tweens.add({
                        targets: rays,
                        alpha: 0.35,
                        scaleX: 1,
                        scaleY: 1,
                        duration: 900,
                        onComplete: () => {
                            // Resolve before the animation finishes to have some overlap
                            resolve();
                            // Ray fly up
                            this.scene.tweens.add({
                                targets: rays,
                                y: -96,
                                scaleX: 1.5,
                                scaleY: 3,
                                alpha: 0,
                                ease: 'Quadratic.Out',
                                duration: 600,
                                onComplete: () => {
                                    rays.destroy();
                                },
                            });
                        },
                    });
                }
            });
        });
    }

    public beingHealedAnimation(): Promise<void> {
        return new Promise((resolve) => {
            const rays = this.scene.add.image(this.x, -92, 'heal-effect-rays')
                .setAlpha(0.35)
                .setOrigin(0.5, 64 / 92); // cirlce is 64 high, beam is 92, need origins to line up
            // Ray down
            this.scene.tweens.add({
                targets: rays,
                y: this.y,
                scaleY: 2,
                ease: 'Quadratic.In',
                duration: 900,
                onComplete: () => {
                    // Resolve before the animation finishes to have some overlap
                    resolve();
                    // Ray fade
                    this.scene.tweens.add({
                        targets: rays,
                        scaleX: 1,
                        scaleY: 0,
                        alpha: 0,
                        duration: 600,
                        onComplete: () => {
                            rays.destroy();
                        },
                    });
                },
            });
        });
    }

    public performAttackAnimation(): Promise<void> {
        return new Promise((resolve) => {
            this.playAnimation('attack');

            // Lunge forward slightly
            this.scene.tweens.add({
                targets: this,
                x: this.x + 12,
                duration: 200,
                yoyo: true,
                onComplete: () => {
                    this.playAnimation('idle');
                    resolve();
                }
            });
        });
    }

    public dieAnimation(): Promise<void> {
        return new Promise((resolve) => {
            this.playAnimation('death');
            const target = this.sprite || this.image;
            this.destroyPlans();
            if (target) {
                // Fade out and fall
                this.scene.tweens.add({
                    targets: [target, this.hpBar],
                    alpha: 0,
                    angle: 90,
                    y: target.y + 50,
                    duration: 1000,
                    onComplete: () => resolve()
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Immediately hide dead enemy without animation
     */
    public hideDeadEnemy(): void {
        this.hpBar.setLabel('DEAD');
        const target = this.sprite || this.image;
        if (target) {
            target.setAlpha(0);
        }
        this.hpBar.setAlpha(0);
        this.destroyPlans();
    }
}

export class EnemyManager {
    private scene: Phaser.Scene;
    private layout: BattleLayout;
    private enemies: Actor[] = [];

    constructor(scene: Phaser.Scene, layout: BattleLayout) {
        this.scene = scene;
        this.layout = layout;
    }

    public createEnemies(battle: BattleConfig): Actor[] {
        // Clear existing enemies
        this.enemies.forEach(enemy => enemy.destroy());
        this.enemies = [];

        const enemyYOffsets = [
            [0],
            [0, 16],
            [25, 0, 25]
        ];

        for (let i = 0; i < battle.enemies.count; ++i) {
            const stats = battle.enemies.stats[i];
            const actor = new Actor(
                this.scene, 
                this.layout.enemyX(battle, i), 
                this.layout.enemyY() + enemyYOffsets[Number(battle.enemies.count) - 1][i],
                stats
            );
            this.enemies.push(actor);
        }

        return this.enemies;
    }

    public setEnemyPlans(config: BattleConfig, battleState: BattleState) {
        const stats = config.enemies.stats;
        const oldDamageToEnemy = [battleState.damage_to_enemy_0, battleState.damage_to_enemy_1, battleState.damage_to_enemy_2];
        const moves = [
            stats[0].moves[Number(battleState.enemy_move_index_0)],
            stats[1].moves[Number(battleState.enemy_move_index_1)],
            stats[2].moves[Number(battleState.enemy_move_index_2)],
        ];
        for (let i = 0; i < config.enemies.count; ++i) {
            if (oldDamageToEnemy[i] < stats[i].hp) {
                const move = moves[i];
                const attack = Number(move.attack);
                if (attack != 0) {
                    this.enemies[i].setAttackPlan(attack);
                }
                const blockSelf = Number(move.block_self);
                if (blockSelf != 0) {
                    this.enemies[i].setBlockSelfPlan(blockSelf);
                }
                const blockAllies = Number(move.block_allies);
                if (blockAllies != 0) {
                    this.enemies[i].setBlockAlliesPlan(blockAllies);
                }
                const healSelf = Number(move.heal_self);
                if (healSelf != 0) {
                    this.enemies[i].setHealSelfPlan(healSelf);
                }
                const healAllies = Number(move.heal_allies);
                if (healAllies != 0) {
                    this.enemies[i].setHealAlliesPlan(healAllies);
                }
            }
        }
    }

    /**
     * Apply accumulated damage from BattleState to enemy actors
     * This is needed when rejoining an existing battle to show current HP
     */
    public applyBattleStateDamage(config: BattleConfig, battleState: BattleState) {
        const stats = config.enemies.stats;
        const damageToEnemy = [battleState.damage_to_enemy_0, battleState.damage_to_enemy_1, battleState.damage_to_enemy_2];

        for (let i = 0; i < config.enemies.count; ++i) {
            const enemy = this.enemies[i];
            const maxHp = Number(stats[i].hp);
            const damage = Number(damageToEnemy[i]);

            // Calculate current HP based on accumulated damage
            enemy.hp = Math.max(0, maxHp - damage);
            enemy.hpBar.setValue(enemy.hp);

            // If enemy is already dead, immediately hide them
            if (enemy.hp <= 0) {
                enemy.hideDeadEnemy();
            }
        }
    }

    public getEnemies(): Actor[] {
        return this.enemies;
    }

    public clearBlocks() {
        this.enemies.forEach(enemy => enemy.setBlock(0));
    }

    public updateReferences(newEnemies: Actor[]) {
        this.enemies = newEnemies;
    }
}