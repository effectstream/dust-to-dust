import { Game2DerivedState } from "game2-api";
import { BattleConfig, pureCircuits, EFFECT_TYPE, Effect } from "game2-contract";
import { SpiritWidget } from "../widgets/ability";
import { Actor } from "../battle/EnemyManager";
import { BattleLayout } from "./BattleLayout";
import { Color, colorToNumber } from "../constants/colors";
import { logger } from "../main";

export enum BattlePhase {
    SPIRIT_TARGETING,
    COMBAT_ANIMATION
}

export class SpiritManager {
    private scene: Phaser.Scene;
    private layout: BattleLayout;
    private spirits: SpiritWidget[] = [];
    private enemies: Actor[] = [];
    
    // Targeting state
    private battlePhase: BattlePhase = BattlePhase.SPIRIT_TARGETING;
    private currentSpiritIndex: number = 0;
    private spiritTargets: (number | null)[] = [null, null, null];
    
    // Mouse tracking for spirit leaning
    private mouseMoveHandler?: (pointer: Phaser.Input.Pointer) => void;
    
    // Selection effects
    private selectionGlow?: Phaser.GameObjects.Graphics;
    
    // Callbacks
    private onAllSpiritsTargeted?: () => void;
    private onSpiritSelected?: (index: number) => void;
    private onTargetingStarted?: () => void;

    constructor(scene: Phaser.Scene, layout: BattleLayout) {
        this.scene = scene;
        this.layout = layout;
    }

    public createSpirits(state: Game2DerivedState, battle: BattleConfig): SpiritWidget[] {
        // Clean up existing spirits first
        this.cleanupSpirits();

        const battleConfig = state.activeBattleConfigs.get(pureCircuits.derive_battle_id(battle));
        const battleState = state.activeBattleStates.get(pureCircuits.derive_battle_id(battle));
        
        if (!battleConfig || !battleState) {
            logger.combat.debug('No battleConfig or battleState found: ', battleConfig, battleState);
            return this.spirits;
        }
        
        const abilityIds = battleState.deck_indices.map((i) => battleConfig.loadout.abilities[Number(i)]);
        const abilities = abilityIds.map((id) => state.allAbilities.get(id)!);
        
        // Create new spirits
        this.spirits = abilities.map((ability, i) => new SpiritWidget(
            this.scene, 
            this.layout.spiritX(i), 
            this.layout.spiritY(), 
            ability
        ));

        return this.spirits;
    }

    public getSpirits(): SpiritWidget[] {
        return this.spirits;
    }

    public cleanupSpirits() {
        this.spirits.forEach((s) => s.destroy());
        this.spirits = [];
        
        // Clean up selection glow
        if (this.selectionGlow) {
            this.scene.tweens.killTweensOf(this.selectionGlow);
            this.selectionGlow.destroy();
            this.selectionGlow = undefined;
        }
    }

    public refreshSpiritsForNextRound(state: Game2DerivedState, battle: BattleConfig): SpiritWidget[] {
        return this.createSpirits(state, battle);
    }

    public updateReferences(newSpirits: SpiritWidget[]) {
        this.spirits = newSpirits;
    }

    // === TARGETING FUNCTIONALITY ===

    public setCallbacks(callbacks: {
        onAllSpiritsTargeted?: () => void;
        onSpiritSelected?: (index: number) => void;
        onTargetingStarted?: () => void;
    }) {
        this.onAllSpiritsTargeted = callbacks.onAllSpiritsTargeted;
        this.onSpiritSelected = callbacks.onSpiritSelected;
        this.onTargetingStarted = callbacks.onTargetingStarted;
    }

    public startTargeting() {
        // Safety check: don't start targeting if no enemies are alive
        const aliveEnemies = this.enemies.filter(enemy => enemy.hp > 0);
        if (aliveEnemies.length === 0) {
            logger.combat.error(`Attempted to start targeting with no alive enemies! Enemy HP: [${this.enemies.map(e => e.hp).join(',')}]`);
            return;
        }
        
        this.battlePhase = BattlePhase.SPIRIT_TARGETING;
        this.currentSpiritIndex = 0;
        
        // Reset targeting state
        this.spiritTargets = [null, null, null];
        
        // Notify that targeting has started (e.g., to remove fight button)
        this.onTargetingStarted?.();
        
        // Setup interactions
        this.setupSpiritInteractions();
        this.setupEnemyInteractions();
        
        // Select the first spirit to start targetting
        this.handleCurrentSpirit();
    }

    public getTargets(): (number | null)[] {
        return this.spiritTargets;
    }

    public getBattlePhase(): BattlePhase {
        return this.battlePhase;
    }

    public setBattlePhase(phase: BattlePhase) {
        this.battlePhase = phase;
        
        // Clean up selection glow when transitioning to combat
        if (phase === BattlePhase.COMBAT_ANIMATION && this.selectionGlow) {
            this.scene.tweens.killTweensOf(this.selectionGlow);
            this.selectionGlow.destroy();
            this.selectionGlow = undefined;
        }
    }

    public disableInteractions() {
        this.spirits.forEach(spirit => spirit.disableInteractive());
        this.enemies.forEach(enemy => enemy.disableInteractive());
        
        // Disable mouse tracking
        this.disableMouseTracking();
        
        // Remove spirit highlights and animations
        this.spirits.forEach((spirit) => {
            this.scene.tweens.killTweensOf(spirit);
            this.scene.tweens.killTweensOf(spirit.spirit);
            spirit.y = this.layout.spiritY();
            if (spirit.spirit) {
                spirit.spirit.setScale(2);
            }
        });
    }

    public reset() {
        this.battlePhase = BattlePhase.SPIRIT_TARGETING;
        this.currentSpiritIndex = 0;
        this.spiritTargets = [null, null, null];
    }

    public updateTargetingReferences(spirits: SpiritWidget[], enemies: Actor[]) {
        this.spirits = spirits;
        this.enemies = enemies;
    }

    private effectNeedsTargeting(effect: Effect): boolean {
        // Block effects don't need targeting
        if (effect.effect_type === EFFECT_TYPE.block) {
            return false;
        }
        
        // Attack effects need targeting only if they're not AoE
        const isAttack = effect.effect_type === EFFECT_TYPE.attack_fire ||
                        effect.effect_type === EFFECT_TYPE.attack_ice ||
                        effect.effect_type === EFFECT_TYPE.attack_phys;
        
        return isAttack && !effect.is_aoe;
    }

    private shouldSkipTargeting(spiritIndex: number): boolean {
        if (spiritIndex < 0 || spiritIndex >= this.spirits.length) return false;
        
        const spirit = this.spirits[spiritIndex];
        const ability = spirit.ability;
        
        // Check if main effect needs targeting
        const mainNeedsTargeting = ability.effect.is_some && this.effectNeedsTargeting(ability.effect.value);
        
        // Check energy effects that need targeting and would actually be triggered
        let energyNeedsTargeting = false;
        if (ability.on_energy) {
            for (let colorIndex = 0; colorIndex < ability.on_energy.length; colorIndex++) {
                const energyEffect = ability.on_energy[colorIndex];
                if (energyEffect.is_some && this.effectNeedsTargeting(energyEffect.value)) {
                    // Check if any OTHER spirit in this combat round would generate this color
                    const wouldBeTriggered = this.spirits.some((otherSpirit, otherIndex) => 
                        otherIndex !== spiritIndex && 
                        otherSpirit.ability.generate_color.is_some && 
                        Number(otherSpirit.ability.generate_color.value) === colorIndex
                    );
                    
                    // If this energy effect would be triggered, then this spirit needs targeting
                    if (wouldBeTriggered) {
                        energyNeedsTargeting = true;
                        break;
                    }
                }
            }
        }
        
        // Skip targeting if neither main nor energy effects need it
        return !mainNeedsTargeting && !energyNeedsTargeting;
    }

    private handleCurrentSpirit() {
        // If current spirit should skip targeting, auto-target and move to next
        if (this.shouldSkipTargeting(this.currentSpiritIndex)) {
            const firstAliveEnemy = this.enemies.findIndex(enemy => enemy.hp > 0);
            if (firstAliveEnemy !== -1) {
                this.spiritTargets[this.currentSpiritIndex] = firstAliveEnemy;
                this.moveToNextUntagetedSpirit();
                this.checkAllSpiritsTargeted();
                
                // If there are more spirits to target, handle the next one
                if (this.currentSpiritIndex !== -1) {
                    this.handleCurrentSpirit();
                }
                return;
            }
        }
        
        // Normal highlighting for attack spirits
        this.highlightCurrentSpirit();
    }

    private setupSpiritInteractions() {
        this.spirits.forEach((spirit, index) => {
            // Check if spirit is still valid and has a scene
            if (!spirit || !spirit.scene) {
                logger.combat.error(`Spirit ${index} is invalid or has no scene`);
                return;
            }
            
            spirit.removeAllListeners();
            
            // Only show hand cursor if spirit can be manually selected (not auto-skipped)
            const canManuallySelect = !this.shouldSkipTargeting(index);
            
            spirit.setInteractive({ useHandCursor: canManuallySelect })
                .on('pointerdown', () => this.selectSpirit(index));
        });
    }

    private setupEnemyInteractions() {
        this.enemies.forEach((enemy, index) => {
            // Check if enemy is still valid and has a scene
            if (!enemy || !enemy.scene) {
                logger.combat.error(`Enemy ${index} is invalid or has no scene`);
                return;
            }
            
            enemy.removeAllListeners();
            
            // Only make alive enemies interactive
            if (enemy.hp > 0) {
                enemy.setInteractive()
                    .on('pointerdown', () => {
                        // Check if current spirit can attack and we have a selected spirit
                        if (this.currentSpiritIndex !== -1 && !this.shouldSkipTargeting(this.currentSpiritIndex)) {
                            this.targetEnemy(index);
                        }
                    })
                    .on('pointerover', () => {
                        if (this.battlePhase === BattlePhase.SPIRIT_TARGETING && this.currentSpiritIndex !== -1 && !this.shouldSkipTargeting(this.currentSpiritIndex)) {
                            // Set hand cursor when hovering over targetable enemy
                            this.scene.input.setDefaultCursor('pointer');
                            if (enemy.sprite) {
                                enemy.sprite.setTint(colorToNumber(Color.Green));
                            } else if (enemy.image) {
                                enemy.image.setTint(colorToNumber(Color.Green));
                            }
                        }
                    })
                    .on('pointerout', () => {
                        // Always reset cursor when leaving enemy
                        this.scene.input.setDefaultCursor('default');
                        if (enemy.sprite) {
                            enemy.sprite.clearTint();
                        } else if (enemy.image) {
                            enemy.image.clearTint();
                        }
                    });
            } else {
                // Make sure dead enemies are completely non-interactive
                enemy.disableInteractive();
                // Remove any existing interactive area completely
                if (enemy.input) {
                    enemy.removeInteractive();
                }
            }
        });
    }

    private resetSpiritToDefault(spiritIndex: number) {
        if (spiritIndex < 0 || spiritIndex >= this.spirits.length) return;
        
        const spirit = this.spirits[spiritIndex];
        if (spirit) {
            this.scene.tweens.add({
                targets: spirit,
                y: this.layout.spiritY(),
                duration: 400,
                ease: 'Power2.easeOut'
            });
            if (spirit.spirit) {
                spirit.spirit.setScale(2);
            }
        }
    }

    private selectSpirit(index: number) {
        if (this.battlePhase !== BattlePhase.SPIRIT_TARGETING) return;
        
        const previousIndex = this.currentSpiritIndex;
        this.currentSpiritIndex = index;
        
        // Reset the previously selected spirit if it's different
        if (previousIndex !== index) {
            this.resetSpiritToDefault(previousIndex);
        }
        
        // If this spirit should skip targeting, auto-target the first alive enemy and move on
        if (this.shouldSkipTargeting(index)) {
            const firstAliveEnemy = this.enemies.findIndex(enemy => enemy.hp > 0);
            if (firstAliveEnemy !== -1) {
                this.spiritTargets[index] = firstAliveEnemy;
                this.moveToNextUntagetedSpirit();
                this.checkAllSpiritsTargeted();
                return;
            }
        }
        
        this.highlightCurrentSpirit();
        this.onSpiritSelected?.(index);
    }

    private targetEnemy(enemyIndex: number) {
        if (this.battlePhase !== BattlePhase.SPIRIT_TARGETING) return;
        if (this.enemies[enemyIndex].hp <= 0) return; // Can't target dead enemies
        
        // Play enemy selection sound
        this.scene.sound.play('battle-select-enemy-attack', { volume: 0.5 });
        
        // Set target for current spirit
        this.spiritTargets[this.currentSpiritIndex] = enemyIndex;
        
        // Move to next spirit that doesn't have a target
        this.moveToNextUntagetedSpirit();
        
        // Check if all spirits have targets
        this.checkAllSpiritsTargeted();
    }

    private moveToNextUntagetedSpirit() {
        const previousIndex = this.currentSpiritIndex;
        let nextIndex = (this.currentSpiritIndex + 1) % 3;
        let attempts = 0;
        
        // Find next spirit without a target
        while (this.spiritTargets[nextIndex] !== null && attempts < 3) {
            nextIndex = (nextIndex + 1) % 3;
            attempts++;
        }
        
        if (attempts < 3) {
            this.currentSpiritIndex = nextIndex;
        } else {
            // All spirits have targets, no need to highlight
            this.currentSpiritIndex = -1;  
        }

        // Reset the previously selected spirit to default position
        this.resetSpiritToDefault(previousIndex);

        // Handle the current spirit (could be defense-only)
        if (this.currentSpiritIndex !== -1) {
            this.handleCurrentSpirit();
        }
    }

    private highlightCurrentSpirit() {
        // Disable mouse tracking for the previous spirit
        this.disableMouseTracking();
        
        // Clean up previous selection glow and stop its pulsing
        if (this.selectionGlow) {
            this.scene.tweens.killTweensOf(this.selectionGlow);
            this.selectionGlow.destroy();
            this.selectionGlow = undefined;
        }
        
        // Reset visual state for spirits that aren't current and don't have targets
        this.spirits.forEach((spirit, index) => {
            if (spirit.spirit) {
                // Only reset spirits that aren't currently selected and don't have targets
                if (index !== this.currentSpiritIndex && this.spiritTargets[index] === null) {
                    this.scene.tweens.killTweensOf(spirit.spirit);
                    spirit.spirit.setScale(2);
                }
            }
        });
        
        // Highlight and bring forward the current spirit
        const currentSpirit = this.spirits[this.currentSpiritIndex];
        if (currentSpirit && currentSpirit.spirit) {
            logger.combat.debug(`Found current spirit, enabling mouse tracking`);
            
            // Create glow/aura circle behind the spirit
            this.selectionGlow = this.scene.add.graphics();
            this.selectionGlow.fillStyle(colorToNumber(Color.Green), 0.3);
            this.selectionGlow.fillCircle(0, 0, 50);
            
            // Add dashed outline
            this.selectionGlow.lineStyle(3, colorToNumber(Color.Green), 0.8);
            this.selectionGlow.strokeCircle(0, 0, 50);
            
            this.selectionGlow.setPosition(currentSpirit.x, currentSpirit.y);
            this.selectionGlow.setDepth(-1);
            
            // Animate the glow with subtle pulsing effect
            this.scene.tweens.add({
                targets: this.selectionGlow,
                alpha: 0.25,
                scaleX: 1.05,
                scaleY: 1.05,
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            
            // Move forward and up slightly (both spirit and glow)
            const targetY = this.layout.spiritY() - 30;
            this.scene.tweens.add({
                targets: currentSpirit,
                y: targetY,
                duration: 400,
                ease: 'Back.easeOut'
            });
            
            // Make glow follow the initial positioning tween
            if (this.selectionGlow) {
                this.scene.tweens.add({
                    targets: this.selectionGlow,
                    y: targetY,
                    duration: 400,
                    ease: 'Back.easeOut'
                });
            }
            
            // Enable mouse tracking for the current spirit
            this.enableMouseTrackingForSpirit(currentSpirit);
        }
    }

    private checkAllSpiritsTargeted() {
        if (this.battlePhase !== BattlePhase.SPIRIT_TARGETING) {
            return;
        }
        
        const allTargeted = this.spiritTargets.every(target => target !== null);
        
        if (allTargeted) {
            // Clean up selection glow when all spirits are targeted
            if (this.selectionGlow) {
                this.scene.tweens.killTweensOf(this.selectionGlow);
                this.selectionGlow.destroy();
                this.selectionGlow = undefined;
            }
            
            // Update enemy interactions to remove pointer cursor
            this.setupEnemyInteractions();
            
            this.onAllSpiritsTargeted?.();
        }
    }


    private enableMouseTrackingForSpirit(spirit: SpiritWidget) {
        if (!spirit || !spirit.spirit) {
            return;
        }
        
        // Remove any existing handler first
        this.removeMouseHandler();
        
        // Store the original highlighted position (base position for lean calculations)
        const baseX = this.layout.spiritX(this.currentSpiritIndex);
        const baseY = this.layout.spiritY() - 30; // Account for highlight offset
        
        // Create and store the mouse move handler
        this.mouseMoveHandler = (pointer: Phaser.Input.Pointer) => {
            if (this.battlePhase !== BattlePhase.SPIRIT_TARGETING) return;
            if (this.spirits[this.currentSpiritIndex] !== spirit) return;
            
            // Simple lean toward cursor
            const deltaX = pointer.x - baseX;
            const deltaY = pointer.y - baseY;
            const leanX = deltaX * 0.04; // 4% of the distance
            const leanY = deltaY * 0.04;
            
            // Apply position to the container - always relative to base position
            const newX = baseX + leanX;
            const newY = baseY + leanY;
            this.scene.tweens.add({
                targets: spirit,
                x: newX,
                y: newY,
                duration: 100,
                ease: 'Power2.easeOut'
            });
            
            // Update glow position to follow the spirit immediately
            if (this.selectionGlow) {
                this.selectionGlow.setPosition(newX, newY);
            }
        };
        
        // Add the handler
        this.scene.input.on('pointermove', this.mouseMoveHandler);
    }

    private removeMouseHandler() {
        if (this.mouseMoveHandler) {
            this.scene.input.removeListener('pointermove', this.mouseMoveHandler);
            this.mouseMoveHandler = undefined;
        }
    }

    private disableMouseTracking() {
        // Remove the specific handler
        this.removeMouseHandler();
        
        // Reset position on all spirits
        this.spirits.forEach((spirit, index) => {
            if (spirit) {
                // Reset position to layout position
                spirit.x = this.layout.spiritX(index);
                spirit.y = this.layout.spiritY();
            }
        });
    }
}