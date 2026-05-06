import { EFFECT_TYPE, Ability, BattleConfig } from "game2-contract";
import { AbilityWidget, energyTypeToColor, SpiritWidget, effectTypeFileAffix } from "../widgets/ability";
import { SPIRIT_ANIMATION_DURATIONS, chargeAnimKey, orbAuraIdleKey, spiritAuraIdleKey } from "../animations/spirit";
import { addScaledImage, scale } from "../utils/scaleImage";
import { colorToNumber, Color } from "../constants/colors";
import { BattleLayout } from "./BattleLayout";
import { CombatCallbacks } from "../battle/logic";
import { logger, fontStyle } from "../main";
import { BattleEffect, BattleEffectType } from "../widgets/BattleEffect";
import { Actor } from "./EnemyManager";
import { RainbowText } from "../widgets/rainbow-text";
import { Def } from "../constants/def";

export class CombatAnimationManager {
    private scene: Phaser.Scene;
    private layout: BattleLayout;
    private spirits: SpiritWidget[];
    private abilityIcons: AbilityWidget[];
    private enemies: Actor[];
    private player: Actor;
    private battle: BattleConfig;
    private background: Phaser.GameObjects.GameObject | null = null;
    private readonly skipAnimations: boolean;

    constructor(
        scene: Phaser.Scene,
        layout: BattleLayout,
        spirits: SpiritWidget[],
        abilityIcons: AbilityWidget[],
        enemies: Actor[],
        player: Actor,
        battle: BattleConfig,
        background?: Phaser.GameObjects.GameObject
    ) {
        this.scene = scene;
        this.layout = layout;
        this.spirits = spirits;
        this.abilityIcons = abilityIcons;
        this.enemies = enemies;
        this.player = player;
        this.battle = battle;
        this.background = background || null;
        this.skipAnimations = import.meta.env.VITE_SKIP_BATTLE_ANIMATIONS === 'true';

        if (this.skipAnimations) {
            logger.combat.info('[DEBUG MODE] Battle animations disabled - state updates only');
        }
    }

    private shakeScreen(intensity: number = 5, duration: number = 500) {
        if (this.skipAnimations) return;

        // Get all game objects except background (properly exclude the background object)
        const objectsToShake = this.scene.children.list.filter((child) => {
            // Skip the background object if we have a reference to it
            return child !== this.background;
        }).filter(child => 'x' in child && 'y' in child) as Array<Phaser.GameObjects.GameObject & { x: number, y: number }>;

        if (objectsToShake.length === 0) return;

        // Store original positions
        const originalPositions = objectsToShake.map(obj => ({ x: obj.x, y: obj.y }));

        // Create shake effect with easing out
        const shakeData = { intensity: intensity, progress: 0 };
        this.scene.tweens.add({
            targets: shakeData,
            intensity: 0,
            progress: 1,
            duration: duration,
            ease: 'Power2.easeOut',
            onUpdate: () => {
                objectsToShake.forEach((obj, i) => {
                    const original = originalPositions[i];
                    const currentIntensity = shakeData.intensity;
                    obj.x = original.x + Phaser.Math.Between(-currentIntensity, currentIntensity);
                    obj.y = original.y + Phaser.Math.Between(-currentIntensity, currentIntensity);
                });
            },
            onComplete: () => {
                // Reset all objects to original positions
                objectsToShake.forEach((obj, i) => {
                    const original = originalPositions[i];
                    obj.x = original.x;
                    obj.y = original.y;
                });
            }
        });
    }

    public updateReferences(
        spirits: SpiritWidget[],
        abilityIcons: AbilityWidget[],
        enemies: Actor[],
        player: Actor
    ) {
        this.spirits = spirits;
        this.abilityIcons = abilityIcons;
        this.enemies = enemies;
        this.player = player;
    }

    private static readonly EFFECTIVENESS_DISPLAY = {
        [Def.IMMUNE]: { text: "IMMUNE", color: Color.Blue, useRainbow: false, sound: 'attack-immune', shake: { intensity: 0, duration: 0 } },
        [Def.WEAK]: { text: "WEAK", color: Color.Red, useRainbow: false, sound: 'attack-weak', shake: { intensity: 0, duration: 0 } },
        [Def.NEUTRAL]: { text: "", color: Color.White, useRainbow: false, sound: 'attack-neutral', shake: { intensity: 2, duration: 100 } },
        [Def.EFFECTIVE]: { text: "EFFECTIVE", color: Color.Green, useRainbow: false, sound: 'attack-effective', shake: { intensity: 3, duration: 300 } },
        [Def.SUPEREFFECTIVE]: { text: "SUPER\nEFFECTIVE", color: Color.White, useRainbow: true, sound: 'attack-supereffective', shake: { intensity: 5, duration: 400 } }
    };

    private showEffectivenessText(x: number, y: number, defenseLevel: Def) {
        if (this.skipAnimations) return;

        const display = CombatAnimationManager.EFFECTIVENESS_DISPLAY[defenseLevel];
        if (!display) return;

        const { text, color, useRainbow, sound, shake } = display;

        // Play sound effect
        this.scene.sound.play(sound, { volume: defenseLevel >= Def.EFFECTIVE ? 1.0 : 0.8 });

        // Shake screen for stronger attacks
        if (shake.intensity > 0) {
            this.shakeScreen(shake.intensity, shake.duration);
        }
        if (text) {
            const effectivenessText = useRainbow
                ? new RainbowText(this.scene, x, y - 40, text, 6, fontStyle(16), true)
                : new Phaser.GameObjects.Text(this.scene, x, y - 40, text, {
                    ...fontStyle(16),
                    color: color,
                    align: 'center'
                }).setOrigin(0.5).setStroke(Color.Licorice, 10);

            this.scene.add.existing(effectivenessText);

            // Animate the text
            this.scene.tweens.add({
                targets: effectivenessText,
                alpha: 0,
                y: y - 80,
                duration: 2000,
                ease: 'Power2',
                onComplete: () => effectivenessText.destroy()
            });
        }
    }

    public createCombatCallbacks(): CombatCallbacks {
        return {
            onEnemyBlock: (enemy: number, targets: number[], amount: number) => {
                logger.combat.debug(`enemy [${enemy}] blocked for ${amount} | ${this.enemies.length}`);

                // Clear planned action
                if (targets.length == 1 && targets[0] == enemy) {
                    this.enemies[enemy].clearBlockSelfPlan();
                } else {
                    this.enemies[enemy].clearBlockAlliesPlan();
                }

                // Apply state updates
                targets.forEach((target) => {
                    this.enemies[target].addBlock(amount);
                });

                // Skip animations if debug flag is set
                if (this.skipAnimations) {
                    return Promise.resolve();
                }

                // Show block effect animation
                return new Promise((resolve) => {
                    targets.forEach((target) => {
                        new BattleEffect(
                            this.scene,
                            this.layout.enemyX(this.battle, target),
                            this.layout.enemyY() - 20,
                            BattleEffectType.BLOCK,
                            amount,
                            () => resolve()
                        );
                    });
                    this.scene.add.existing(this.scene.children.list[this.scene.children.list.length - 1]);
                });
            },

            onEnemyAttack: (enemy: number, amount: number) => {
                this.enemies[enemy].clearAttackPlan();

                // Skip animations if debug flag is set
                if (this.skipAnimations) {
                    this.player?.damage(amount);
                    return Promise.resolve();
                }

                // Play attack animation
                return new Promise((resolve) => {
                    this.enemies[enemy].performAttackAnimation().then(() => {
                        const fist = addScaledImage(this.scene, this.layout.enemyX(this.battle, enemy), this.layout.enemyY(), 'physical');
                        this.scene.tweens.add({
                            targets: fist,
                            x: this.layout.playerX(),
                            y: this.layout.playerY(),
                            duration: 100,
                            onComplete: () => {
                                fist.destroy();
                                this.player?.damage(amount);

                                // Shake screen when player is attacked
                                this.shakeScreen(4, 200);

                                // Play neutral attack sound when player is hit
                                this.scene.sound.play('attack-neutral', { volume: 0.5 });

                                // Show damage effect on player
                                new BattleEffect(
                                    this.scene,
                                    this.layout.playerX(),
                                    this.layout.playerY() - 20,
                                    BattleEffectType.ATTACK_PHYS,
                                    amount,
                                    () => resolve()
                                );
                                this.scene.add.existing(this.scene.children.list[this.scene.children.list.length - 1]);
                            }
                        });
                    });
                });
            },

            onEnemyHeal: (enemy: number, targets: number[], amount: number) => {
                logger.combat.debug(`enemy [${enemy}] healed for ${amount} | ${this.enemies.length}`);

                // Clear planned action
                if (targets.length == 1 && targets[0] == enemy) {
                    this.enemies[enemy].clearHealSelfPlan();
                } else {
                    this.enemies[enemy].clearHealAlliesPlan();
                }

                // Apply state updates immediately if skipping animations
                if (this.skipAnimations) {
                    targets.forEach((target) => {
                        this.enemies[target].heal(amount);
                    });
                    return Promise.resolve();
                }

                // Play heal animation
                return new Promise((resolve) => {
                    this.enemies[enemy].castHealAnimation().then(() => {
                        if (targets.length == 1 && enemy == targets[0]) {
                            new BattleEffect(
                                this.scene,
                                this.layout.enemyX(this.battle, enemy),
                                this.layout.enemyY() - 20,
                                BattleEffectType.HEAL,
                                amount,
                                () => {
                                    this.enemies[enemy].heal(amount);
                                    resolve();
                                }
                            )
                        } else {
                            targets.forEach((target) => {
                                this.enemies[target].beingHealedAnimation().then(() => new BattleEffect(
                                    this.scene,
                                    this.layout.enemyX(this.battle, target),
                                    this.layout.enemyY() - 20,
                                    BattleEffectType.HEAL,
                                    amount,
                                    () => {
                                        this.enemies[target].heal(amount);
                                        resolve();
                                    }
                                ));
                            });
                        }
                    });
                    this.scene.add.existing(this.scene.children.list[this.scene.children.list.length - 1]);
                });
            },

            onPlayerEffect: (source: number, targets: number[], effectType: EFFECT_TYPE, amounts: number[]) => {
                let damageType = undefined;
                switch (effectType) {
                    case EFFECT_TYPE.attack_fire:
                        damageType = 'fire';
                        break;
                    case EFFECT_TYPE.attack_ice:
                        damageType = 'ice';
                        break;
                    case EFFECT_TYPE.attack_phys:
                        damageType = 'physical';
                        break;
                    case EFFECT_TYPE.block:
                        this.player?.addBlock(amounts[0]);

                        // Skip animations if debug flag is set
                        if (this.skipAnimations) {
                            return Promise.resolve();
                        }

                        // Show block effect
                        new BattleEffect(
                            this.scene,
                            this.layout.playerX(),
                            this.layout.playerY() - 20,
                            BattleEffectType.BLOCK,
                            amounts[0],
                            () => {}
                        );
                        this.scene.add.existing(this.scene.children.list[this.scene.children.list.length - 1]);
                        break;
                }

                if (damageType != undefined) {
                    // Apply damage immediately if skipping animations
                    if (this.skipAnimations) {
                        for (let i = 0; i < targets.length; ++i) {
                            const target = targets[i];
                            const amount = amounts[i];
                            this.enemies[target].damage(amount);
                        }
                        return Promise.resolve();
                    }

                    // Play attack animation
                    return new Promise((resolve) => {
                        for (let i = 0; i < targets.length; ++i) {
                            const target = targets[i];
                            const amount = amounts[i];
                            const bullet = addScaledImage(this.scene, this.layout.spiritX(source), this.layout.spiritY(), damageType);
                            this.scene.tweens.add({
                                targets: bullet,
                                x: this.layout.enemyX(this.battle, target),
                                y: this.layout.enemyY(),
                                duration: 150,
                                onComplete: () => {
                                    this.enemies[target].damage(amount);
                                    this.enemies[target].takeDamageAnimation();
                                    bullet.destroy();

                                    // Get defense level from enemy and show all effectiveness feedback
                                    const defenseLevel = this.enemies[target].getDefenseAgainst(effectType);
                                    this.showEffectivenessText(
                                        this.layout.enemyX(this.battle, target),
                                        this.layout.enemyY(),
                                        defenseLevel
                                    );

                                    // Show damage number effect
                                    new BattleEffect(
                                        this.scene,
                                        this.layout.enemyX(this.battle, target),
                                        this.layout.enemyY() - 20,
                                        Number(effectType) as BattleEffectType,
                                        amount,
                                        () => resolve()
                                    );
                                    this.scene.add.existing(this.scene.children.list[this.scene.children.list.length - 1]);
                                },
                            });
                        }
                    });
                } else {
                    // Resolve immediately for block effects
                    return Promise.resolve();
                }
            },

            onDrawAbilities: (abilities: Ability[]) => {
                // Only create ability cards if they don't already exist (from targeting phase)
                if (this.abilityIcons.length === 0) {
                    this.abilityIcons = abilities.map((ability, i) => new AbilityWidget(this.scene, (this.scene.game.config.width as number) * (i + 0.5) / abilities.length, this.layout.abilityIdleY(), ability).setAlpha(0));
                } else {
                    // Ability cards already exist from targeting, just ensure they're positioned correctly and visible
                    this.abilityIcons.forEach((abilityIcon, i) => {
                        abilityIcon.x = (this.scene.game.config.width as number) * (i + 0.5) / abilities.length;
                        abilityIcon.y = this.layout.abilityIdleY();
                        abilityIcon.setAlpha(1);
                    });
                }

                // Only create spirits if they don't already exist (from targeting phase)
                if (this.spirits.length === 0) {
                    this.spirits = abilities.map((ability, i) => new SpiritWidget(this.scene, (this.scene.game.config.width as number) * (i + 0.5) / abilities.length, this.layout.spiritY(), ability).setAlpha(0));
                } else {
                    // Spirits already exist from targeting, just ensure they're positioned correctly and visible
                    this.spirits.forEach((spirit, i) => {
                        spirit.x = (this.scene.game.config.width as number) * (i + 0.5) / abilities.length;
                        spirit.y = this.layout.spiritY();
                        spirit.setAlpha(1);
                    });
                }

                // Skip fade-in animation if debug flag is set
                if (this.skipAnimations) {
                    this.abilityIcons.forEach(icon => icon.setAlpha(1));
                    this.spirits.forEach(spirit => spirit.setAlpha(1));
                    return Promise.resolve();
                }

                // Fade in abilities and spirits
                return new Promise((resolve) => {
                    this.scene.tweens.add({
                        targets: [...this.abilityIcons, ...this.spirits],
                        alpha: 1,
                        duration: 500,
                        onComplete: () => {
                            resolve();
                        },
                    });
                });
            },

            onUseAbility: (abilityIndex: number, energy?: number) => {
                const abilityIcon = this.abilityIcons[abilityIndex];
                const spirit = this.spirits[abilityIndex];

                // Scale down orb immediately if energy was used
                if (energy != undefined && this.spirits[abilityIndex]?.orbs[energy]) {
                    this.spirits[abilityIndex].orbs[energy]!.setScale(1);
                }

                // Skip animations if debug flag is set
                if (this.skipAnimations) {
                    return Promise.resolve();
                }

                // Play ability use animation
                return new Promise((resolve) => {
                    if (spirit && spirit.spirit) {
                        const spiritType = effectTypeFileAffix(spirit.ability.effect.value.effect_type);
                        const attackAnimKey = `spirit-${spiritType}-attack`;
                        const idleAnimKey = `spirit-${spiritType}`;

                        // Play attack sound when spirit animation starts
                        if (spiritType === 'atk-phys') {
                            this.scene.sound.play('battle-phys-attack', { volume: 0.8 });
                        }
                        else if (spiritType === 'atk-ice') {
                            this.scene.sound.play('battle-ice-attack', { volume: 0.8 });
                        }
                        else if (spiritType === 'atk-fire') {
                            this.scene.sound.play('battle-fire-attack', { volume: 0.8 });
                        }
                        else if (spiritType === 'def') {
                            this.scene.sound.play('battle-def', { volume: 0.8 });
                        }

                        if (this.scene.anims.exists(attackAnimKey)) {
                            spirit.spirit.anims.play(attackAnimKey);
                            this.scene.time.delayedCall(1000, () => {
                                if (spirit.spirit && this.scene.anims.exists(idleAnimKey)) {
                                    spirit.spirit.anims.play(idleAnimKey);
                                }
                            });
                        }
                    }

                    this.scene.tweens.add({
                        targets: [abilityIcon],
                        y: this.layout.abilityInUseY(),
                        delay: 150,
                        duration: 250,
                        onComplete: () => {
                            const uiElement = energy != undefined ? abilityIcon.energyEffectUI[energy] : abilityIcon.baseEffectUI;
                            this.scene.tweens.add({
                                targets: energy != undefined ? [uiElement, spirit.orbs[energy]?.aura] : [uiElement],
                                scale: 1.5,
                                yoyo: true,
                                delay: 100,
                                duration: 200,
                                onComplete: () => resolve(),
                            });
                        },
                    });
                });
            },

            afterUseAbility: (abilityIndex: number) => {
                // Skip animations if debug flag is set
                if (this.skipAnimations) {
                    return Promise.resolve();
                }

                // Move ability card back to idle position
                return new Promise((resolve) => {
                    this.scene.tweens.add({
                        targets: [this.abilityIcons[abilityIndex]],
                        y: this.layout.abilityIdleY(),
                        delay: 150,
                        duration: 250,
                        onComplete: () => {
                            resolve();
                        },
                    });
                });
            },

            onEnergyTrigger: (source: number, color: number) => {
                const aura = this.spirits[source].aura!;
                const targets = [0, 1, 2]
                    .filter((a) => a != source && this.spirits[a].orbs[color] != undefined);

                // Scale up target orbs immediately
                targets.forEach((a) => {
                    const orb = this.spirits[a].orbs[color]!;
                    orb.setScale(1.5);
                });

                if (targets.length === 0 || this.skipAnimations) {
                    return Promise.resolve();
                }

                // Play energy transfer animation
                return new Promise((resolve) => {
                    logger.animation.debug(`[ENERGY-UI] charge!`);
                    aura.anims.play(chargeAnimKey);
                    this.scene.tweens.add({
                        targets: this.scene,
                        delay: 250,
                        duration: SPIRIT_ANIMATION_DURATIONS.charge,
                        completeDelay: 350,
                        onComplete: () => {
                            logger.animation.debug(`[ENERGY-UI] ...charged...`);
                            aura.anims.play(spiritAuraIdleKey);
                            targets.forEach((a) => {
                                logger.animation.debug(`[ENERGY-UI] CREATING BULLET ${source} -> ${a}`);
                                const target = this.spirits[a];
                                const bullet = scale(this.scene.add.sprite(this.layout.spiritX(source), this.layout.spiritY(), 'orb-aura'))
                                    .setTint(colorToNumber(energyTypeToColor(color)));
                                bullet.anims.play(orbAuraIdleKey);
                                this.scene.tweens.add({
                                    targets: bullet,
                                    delay: 100,
                                    duration: 500,
                                    x: target.x,
                                    onUpdate: (tween) => {
                                        bullet.y = this.layout.spiritY() + 32 * Math.sin((tween.progress + (source - a)) * Math.PI);
                                    },
                                    onComplete: () => {
                                        logger.animation.debug(`[ENERGY-UI] DESTROYED BULLET ${source} -> ${a}`);
                                        bullet.destroy();
                                        resolve();
                                    },
                                });
                            });
                        },
                    });
                });
            },

            onEndOfRound: () => {
                this.enemies.forEach((enemy) => enemy.endOfRound());
                this.player?.endOfRound();
                return Promise.resolve();
            },
        };
    }
}
