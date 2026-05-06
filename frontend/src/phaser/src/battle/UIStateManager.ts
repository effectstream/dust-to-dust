import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { Button } from "../widgets/button";
import { AbilityWidget, describeAbility } from "../widgets/ability";
import { BattleConfig, BattleRewards, pureCircuits } from "game2-contract";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../main";
import { MainMenu } from "../menus/main";
import { RetreatButton } from "../widgets/retreat-button";
import { RetreatOverlay } from "../widgets/retreat-overlay";
import { addTooltip } from "../widgets/tooltip";
import { txSpinner } from "../tx-spinner";

// Legacy layout functions - TODO: replace this with layout manager usage
const abilityIdleY = () => GAME_HEIGHT * 0.75;

export class UIStateManager {
    private scene: Phaser.Scene;
    private api: DeployedGame2API;
    private fightButton: Button | null = null;
    private abilityIcons: AbilityWidget[] = [];
    private retreatButton: RetreatButton | null = null;
    private retreatOverlay: RetreatOverlay | null = null;

    constructor(scene: Phaser.Scene, api: DeployedGame2API) {
        this.scene = scene;
        this.api = api;
    }

    public createFightButton(onFightCallback: () => void) {
        // Prevent duplicate buttons
        if (this.fightButton) return;
        
        this.fightButton = new Button(
            this.scene,
            GAME_WIDTH / 2,
            GAME_HEIGHT * 0.90,
            200,
            48,
            'Fight',
            12,
            onFightCallback,
            'Execute this round of combat'
        );
    }

    public removeFightButton() {
        if (this.fightButton) {
            this.fightButton.destroy();
            this.fightButton = null;
        }
    }

    public createAbilityIcons(state: Game2DerivedState, battle: BattleConfig): AbilityWidget[] {
        const battleConfig = state.activeBattleConfigs.get(pureCircuits.derive_battle_id(battle));
        const battleState = state.activeBattleStates.get(pureCircuits.derive_battle_id(battle));
        
        if (!battleConfig || !battleState) return [];
        
        // Clean up existing ability cards
        this.abilityIcons.forEach((a) => a.destroy());
        this.abilityIcons = [];
        
        // Create ability cards
        const abilityIds = battleState.deck_indices.map((i) => battleConfig.loadout.abilities[Number(i)]);
        const abilities = abilityIds.map((id) => state.allAbilities.get(id)!);
        this.abilityIcons = abilities.map((ability, i) => {
            const widget = new AbilityWidget(this.scene, GAME_WIDTH * (i + 0.5) / abilities.length, abilityIdleY(), ability);
            addTooltip(this.scene, widget, describeAbility(ability), 400, 600);
            return widget;
        });

        return this.abilityIcons;
    }

    public refreshAbilityIconsForNextRound(state: Game2DerivedState, battle: BattleConfig): AbilityWidget[] {
        const battleConfig = state.activeBattleConfigs.get(pureCircuits.derive_battle_id(battle));
        const battleState = state.activeBattleStates.get(pureCircuits.derive_battle_id(battle));

        if (!battleConfig || !battleState) return [];

        // Clean up existing ability cards
        this.abilityIcons.forEach((a) => a.destroy());
        this.abilityIcons = [];

        const abilityIds = battleState.deck_indices.map((i) => battleConfig.loadout.abilities[Number(i)]);
        const abilities = abilityIds.map((id) => state.allAbilities.get(id)!);

        // Create new ability cards for the next round
        this.abilityIcons = abilities.map((ability, i) => {
            const widget = new AbilityWidget(this.scene, GAME_WIDTH * (i + 0.5) / abilities.length, abilityIdleY(), ability);
            addTooltip(this.scene, widget, describeAbility(ability), 400, 600);
            return widget;
        });

        return this.abilityIcons;
    }

    public destroyAbilityIcons() {
        this.abilityIcons.forEach((a) => a.destroy());
        this.abilityIcons = [];
    }

    public getAbilityIcons(): AbilityWidget[] {
        return this.abilityIcons;
    }

    public showBattleEndScreen(circuit: BattleRewards, state: Game2DerivedState) {
        if (circuit.alive) {
            this.scene.sound.play('battle-win', { volume: 0.9 });
        } else {
            this.scene.sound.play('battle-lose', { volume: 0.9 });
        }
        const returnButtonText = 'Return to Hub';
        const battleOverText = circuit.alive ? `You won ${circuit.gold} gold!` : `You Died :(`;
        this.scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.52, battleOverText, fontStyle(16)).setOrigin(0.5, 0.5);
        new Button(this.scene, GAME_WIDTH / 2, GAME_HEIGHT * 0.72, GAME_WIDTH * 0.5, GAME_HEIGHT * 0.2, returnButtonText, 16, () => {
            // Stop battle music when returning to hub
            const battleMusic = this.scene.sound.get('boss-battle-music');
            if (battleMusic) {
                battleMusic.stop();
                battleMusic.destroy();
            }

            this.scene.scene.remove('MainMenu');
            this.scene.scene.add('MainMenu', new MainMenu(this.api, state));
            this.scene.scene.start('MainMenu');
        });
        
        if (circuit.alive && circuit.ability.is_some) {
            const rewardAbility = state?.allAbilities.get(circuit.ability.value)!;
            const rewardWidget = new AbilityWidget(this.scene, GAME_WIDTH / 2, GAME_HEIGHT * 0.35, rewardAbility);
            addTooltip(this.scene, rewardWidget, describeAbility(rewardAbility), 400, 600);
            this.scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.1, 'New ability available', fontStyle(12)).setOrigin(0.5, 0.5);
        }
    }

    public createRetreatButton(battle: BattleConfig, state: Game2DerivedState, onRetreatStart: () => void) {
        if (this.retreatButton) return;

        this.retreatButton = new RetreatButton(
            this.scene,
            GAME_WIDTH,
            0,
            () => this.showRetreatConfirmation(battle, state, onRetreatStart)
        );
        this.retreatButton.setDepth(100);
        addTooltip(this.scene, this.retreatButton, 'Flee the battle (no rewards)', 400, 800);
    }

    public removeRetreatButton() {
        if (this.retreatButton) {
            this.retreatButton.destroy();
            this.retreatButton = null;
        }
    }

    private showRetreatConfirmation(battle: BattleConfig, state: Game2DerivedState, onRetreatStart: () => void) {
        // Don't allow multiple overlays
        if (this.retreatOverlay) {
            return;
        }

        // Disable retreat button while overlay is shown
        this.retreatButton?.setEnabled(false);

        this.retreatOverlay = new RetreatOverlay(
            this.scene,
            () => this.executeRetreat(battle, state, onRetreatStart),
            () => {
                // On cancel, re-enable the button
                this.retreatButton?.setEnabled(true);
                this.retreatOverlay = null;
            }
        );
    }

    private async executeRetreat(battle: BattleConfig, _state: Game2DerivedState, onRetreatStart: () => void) {
        // Call the callback to disable interactions in the battle scene
        onRetreatStart();

        // Disable retreat button
        this.retreatButton?.setEnabled(false);

        // Close the overlay and show loader
        this.retreatOverlay = null;
        this.scene.scene.pause().launch('Loader');
        txSpinner.show("Generating Proof");

        try {
            const battleId = pureCircuits.derive_battle_id(battle);

            // Call the retreat API
            await this.api.retreat_from_battle(battleId);

            // Wait for the state to update (battle should be removed from activeBattleConfigs)
            // This prevents a race condition where we navigate to MainMenu before the state updates
            const stateUpdatePromise = new Promise<Game2DerivedState>((resolve, reject) => {
                let subscription: any = null;

                // Add timeout to prevent infinite waiting
                const timeout = setTimeout(() => {
                    if (subscription) {
                        subscription.unsubscribe();
                        subscription = null;
                    }
                    reject(new Error('Timeout waiting for battle state to update'));
                }, 30000); // 30 second timeout

                subscription = this.api.state$.subscribe((updatedState) => {
                    // Check if the battle has been removed from the state
                    if (!updatedState.activeBattleConfigs.has(battleId)) {
                        clearTimeout(timeout);
                        if (subscription) {
                            subscription.unsubscribe();
                            subscription = null;
                        }
                        resolve(updatedState);
                    }
                });
            });

            const updatedState = await stateUpdatePromise;

            // Stop loader
            this.scene.scene.stop('Loader');
            txSpinner.hide();

            // Stop battle music
            const battleMusic = this.scene.sound.get('boss-battle-music');
            if (battleMusic) {
                battleMusic.stop();
                battleMusic.destroy();
            }

            // Cleanup and return to hub
            this.removeRetreatButton();

            // Shutdown old MainMenu to prevent it from reacting to stale state emissions
            const oldMainMenu = this.scene.scene.get('MainMenu') as MainMenu;
            if (oldMainMenu && oldMainMenu.shutdown) {
                oldMainMenu.shutdown();
            }

            // Create new MainMenu
            this.scene.scene.remove('MainMenu');
            const newMainMenu = new MainMenu(this.api, updatedState);

            this.scene.scene.add('MainMenu', newMainMenu);

            // Stop the current battle scene before starting MainMenu
            this.scene.scene.stop();
            this.scene.scene.start('MainMenu');
        } catch (err) {
            logger.network.error(`Error retreating from battle: ${err}`);
            // Stop loader on error
            this.scene.scene.resume().stop('Loader');
            txSpinner.hide();
            // Re-enable interactions on error
            this.retreatButton?.setEnabled(true);
            this.retreatOverlay = null;
        }
    }
}