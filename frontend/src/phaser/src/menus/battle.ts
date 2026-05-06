/**
 * Active battle scene and relevant files.
 */
import { DeployedGame2API, Game2DerivedState, safeJSONString } from "game2-api";
import { GAME_HEIGHT, GAME_WIDTH, logger } from "../main";
import { BattleConfig, pureCircuits, BOSS_TYPE, BattleRewards } from "game2-contract";
import { Subscription } from "rxjs";
import { AbilityWidget, SpiritWidget } from "../widgets/ability";
import { NetworkError } from "./network-error";
import { txSpinner } from "../tx-spinner";
import { addScaledImage } from "../utils/scaleImage";
import { BIOME_ID, biomeToBackground } from "../battle/biome";
import { BattleLayout } from "../battle/BattleLayout";
import { CombatAnimationManager } from "../battle/CombatAnimationManager";
import { EnemyManager, Actor } from "../battle/EnemyManager";
import { SpiritManager, BattlePhase } from "../battle/SpiritManager";
import { UIStateManager } from "../battle/UIStateManager";
import { combat_round_logic } from "../battle/logic";

// Legacy layout functions - TODO: replace these with layout manager usage
const playerX = () => GAME_WIDTH / 2;
const playerY = () => GAME_HEIGHT * 0.95;

export class ActiveBattle extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription;
    battle: BattleConfig;
    state: Game2DerivedState;
    player!: Actor;
    enemies: Actor[];
    abilityIcons: AbilityWidget[];
    spirits: SpiritWidget[];
    background!: Phaser.GameObjects.GameObject;
    round: number;
    rewards: BattleRewards | undefined;
    waitingOnAnimations: boolean;
    initialized: boolean;
    private isDestroyed: boolean = false;

    // Managers
    private layout: BattleLayout;
    private combatAnimationManager!: CombatAnimationManager;
    private enemyManager!: EnemyManager;
    private spiritManager!: SpiritManager;
    private uiStateManager!: UIStateManager;

    constructor(api: DeployedGame2API, battle: BattleConfig, state: Game2DerivedState) {
        super("ActiveBattle");

        logger.combat.debug('ActiveBattle constructor called');
        this.api = api;
        this.battle = battle;
        this.enemies = [];
        this.abilityIcons = [];
        this.spirits = [];
        this.state = state;
        this.round = 0;
        this.waitingOnAnimations = false;
        this.initialized = false;

        // Initialize managers first
        this.layout = new BattleLayout(GAME_WIDTH, GAME_HEIGHT);
        this.enemyManager = new EnemyManager(this, this.layout);
        this.spiritManager = new SpiritManager(this, this.layout);
        this.uiStateManager = new UIStateManager(this, this.api);

        // Subscribe to state AFTER managers are initialized
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
    }

    create() {
        logger.combat.debug('ActiveBattle.create() called');

        // Stop menu music when entering battle
        const menuMusic = this.sound.get('menu-music');
        if (menuMusic) {
            menuMusic.stop();
            menuMusic.destroy();
        }

        // Start battle music
        if (!this.sound.get('boss-battle-music')) {
            const battleMusic = this.sound.add('boss-battle-music', { volume: 0.6, loop: true });
            battleMusic.play();
        }

        this.background = addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, biomeToBackground(Number(this.battle.level.biome) as BIOME_ID)).setDepth(-10);

        // Create player after scene is initialized
        this.player = new Actor(this, playerX(), playerY(), null);
        this.enemies = this.enemyManager.createEnemies(this.battle);

        // Show spinner until battle state is fully available
        txSpinner.show("Preparing battle...");

        // Initialize spirits and start targeting and set enemy plans (if we have the state updated - if not, state updates will trigger this)
        this.initialize();
    }

    private onStateChange(state: Game2DerivedState) {
        logger.gameState.debug(`ActiveBattle.onStateChange(): ${safeJSONString(state)}`);

        // Guard: Check if scene has been destroyed
        if (this.isDestroyed) {
            logger.combat.debug('ActiveBattle.onStateChange() called but scene is destroyed, ignoring');
            return;
        }

        // Guard: Check if scene is still valid and active before processing state changes
        const sceneSettings = this.scene?.settings;
        if (!this.scene || !sceneSettings) {
            logger.combat.debug('ActiveBattle.onStateChange() called but scene is destroyed, ignoring');
            return;
        }

        const sceneStatus = sceneSettings.status;
        // Only process updates if scene is active (RUNNING or PAUSED, but not STOPPED or DESTROYED)
        if (sceneStatus !== Phaser.Scenes.RUNNING && sceneStatus !== Phaser.Scenes.PAUSED) {
            logger.combat.debug(`ActiveBattle.onStateChange() called but scene status is ${sceneStatus}, ignoring`);
            return;
        }

        this.state = structuredClone(state);

        if (!this.initialized) {
            this.initialize();
        }

        // this possibly comes after the round already returned, so try to handle it if that's the case
        this.handleRoundComplete();
    }

    private initialize() {
        if (!this.state || !this.battle) {
            logger.combat.debug('No state or battle found');
            return;
        }

        const battleConfig = this.state.activeBattleConfigs.get(pureCircuits.derive_battle_id(this.battle));
        const battleState = this.state.activeBattleStates.get(pureCircuits.derive_battle_id(this.battle));

        if (!battleConfig || !battleState) {
            logger.combat.debug('No battleConfig or battleState found');
            return;
        }

        this.initializeSpirits();

        this.enemyManager.setEnemyPlans(battleConfig, battleState);

        // Apply accumulated damage to restore HP to current state
        // This is important when rejoining an existing battle
        this.enemyManager.applyBattleStateDamage(battleConfig, battleState);

        // Apply damage to player as well
        const playerDamage = Number(battleState.damage_to_player);
        this.player.hp = Math.max(0, this.player.maxHp - playerDamage);
        this.player.hpBar.setValue(this.player.hp);

        txSpinner.hide();

        // Create retreat button
        this.uiStateManager.createRetreatButton(
            this.battle,
            this.state,
            () => {
                // Disable interactions when retreat is initiated
                this.spiritManager.disableInteractions();
                this.uiStateManager.destroyAbilityIcons();
                this.spiritManager.cleanupSpirits();
            }
        );

        this.initialized = true;
    }

    private initializeSpirits() {
        logger.combat.debug('initializeSpirits called');
        
        // Create spirits using SpiritManager
        this.spirits = this.spiritManager.createSpirits(this.state, this.battle);
        
        // Create ability cards using UIStateManager
        this.abilityIcons = this.uiStateManager.createAbilityIcons(this.state, this.battle);
        
        // Set up spirit manager for targeting
        this.spiritManager.updateTargetingReferences(this.spirits, this.enemies);
        this.spiritManager.setCallbacks({
            onAllSpiritsTargeted: () => this.uiStateManager.createFightButton(() => this.executeCombat()),
            onSpiritSelected: () => {
                // We can add additional spirit selection logic here
            },
            onTargetingStarted: () => this.uiStateManager.removeFightButton()
        });
        
        this.combatAnimationManager = new CombatAnimationManager(
            this,
            this.layout,
            this.spirits,
            this.uiStateManager.getAbilityIcons(),
            this.enemies,
            this.player,
            this.battle,
            this.background
        );
        
        // Start targeting phase
        this.spiritManager.startTargeting();
    }

    private async executeCombat() {
        if (this.spiritManager.getBattlePhase() !== BattlePhase.SPIRIT_TARGETING) return;
        if (!this.spiritManager.getTargets().every(target => target !== null)) return;  
        
        // Immediately remove the fight button to prevent double-clicks
        this.uiStateManager.removeFightButton();
        
        this.spiritManager.setBattlePhase(BattlePhase.COMBAT_ANIMATION);
        this.spiritManager.disableInteractions();
        
        // Execute combat round with selected targets
        await this.runCombat();
    }


    private resetSpirits() {
        // Reset and start targeting for next round
        this.spiritManager.reset();
        this.spiritManager.startTargeting();
    }

    private async runCombat() {
        const id = pureCircuits.derive_battle_id(this.battle);
        const clonedState = structuredClone(this.state!);
        txSpinner.show("Generating Proof");
        
        const retryCombatRound = async (): Promise<BattleRewards | undefined> => {
            try {
                const targets = this.spiritManager.getTargets().map(t => BigInt(t!)) as [bigint, bigint, bigint];
                const result = await this.api.combat_round(id, targets);
                txSpinner.hide();
                logger.gameState.debug(`combat_round = ${result != undefined ? safeJSONString(result) : 'undefined'}`);
                return result;
            } catch (err) {
                txSpinner.hide();
                logger.network.error(`Network Error during combat_round: ${err}`);

                // Show network error overlay
                if (!this.scene.get('NetworkError')) {
                    this.scene.add('NetworkError', new NetworkError());
                }
                const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
                networkErrorScene.setErrorMessage('Network Error during combat. Retrying...');
                this.scene.launch('NetworkError');

                await new Promise(resolve => setTimeout(resolve, 2000));
                this.scene.stop('NetworkError');

                txSpinner.show("Retrying...");

                return retryCombatRound();
            }
        };

        const apiPromise = retryCombatRound();

        // Combat logic to use selected targets
        const uiPromise = this.runUICombatLogic(id, clonedState);
        
        // Wait for both API and UI to finish
        const [circuit, ui] = await Promise.all([apiPromise, uiPromise]);

        this.rewards = circuit;
        
        // Reset for next round or end battle (if state has been updated)
        this.handleRoundComplete();
    }

    private runUICombatLogic(id: bigint, clonedState: Game2DerivedState) {
        const targetsCopy = this.spiritManager.getTargets().map(target => target!) as number[];

        this.waitingOnAnimations = true;
        
        // Update animation manager references and use its callbacks
        this.combatAnimationManager.updateReferences(this.spirits, this.uiStateManager.getAbilityIcons(), this.enemies, this.player);

        // Use the imported combat logic with targets
        return combat_round_logic(id, clonedState, targetsCopy, this.combatAnimationManager.createCombatCallbacks())
            .then((rewards) => {
                this.waitingOnAnimations = false;
                return rewards;
            });
    }

    private handleRoundComplete() {
        const battleConfig = this.state.activeBattleConfigs.get(pureCircuits.derive_battle_id(this.battle));
        const battleState = this.state.activeBattleStates.get(pureCircuits.derive_battle_id(this.battle));
        const combatRoundContinue = !this.waitingOnAnimations && battleState != undefined && battleState.round > this.round;
        // since the combat round ending removes the state we must also check if rewards have been given
        const combatRoundFinished = this.rewards != undefined || combatRoundContinue;
        logger.combat.debug(`ActiveBattle.handleRoundComplete(${combatRoundFinished}) ? ${!this.waitingOnAnimations} && ${battleState != undefined} && ${(battleState?.round ?? 0) > this.round} (${battleState?.round} > ${this.round})`);
        if (combatRoundFinished) {
            this.round = Number(battleState?.round ?? (this.round + 1));
            // Synchronize visual actor HP with battle state HP
            
            this.player?.setBlock(0);
            this.enemyManager.clearBlocks();
            // these should exist but after the battle finishes they don't so safe-guard here
            if (battleConfig != undefined && battleState != undefined) {
                this.enemyManager.setEnemyPlans(battleConfig!, battleState!);
            }
            this.uiStateManager.destroyAbilityIcons();
            
            if (this.rewards != undefined) {
                // Battle is over, show end-of-battle screen
                this.spiritManager.cleanupSpirits();

                // Boss completion is now tracked in the contract state automatically

                this.uiStateManager.showBattleEndScreen(this.rewards, this.state);
            } else {
                // Battle continues, reset targeting state for next round
                // First, refresh spirits for the new round (abilities might have changed)
                this.spirits = this.spiritManager.refreshSpiritsForNextRound(this.state, this.battle);
                this.abilityIcons = this.uiStateManager.refreshAbilityIconsForNextRound(this.state, this.battle);
                
                // Update manager references to the new spirits
                this.spiritManager.updateTargetingReferences(this.spirits, this.enemies);
                this.combatAnimationManager.updateReferences(this.spirits, this.uiStateManager.getAbilityIcons(), this.enemies, this.player);
                
                this.resetSpirits();
            }
        }
    }

    shutdown() {
        // Mark scene as destroyed to prevent any further state updates from processing
        this.isDestroyed = true;

        // Unsubscribe from state updates
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

}
