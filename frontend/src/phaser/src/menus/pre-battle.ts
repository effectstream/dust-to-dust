/**
 * Pre-Battle and Pre-Quest ability selection screen
 */
import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { Ability, BattleConfig, PlayerLoadout, pureCircuits } from "game2-contract";
import { AbilityWidget, describeAbility, SpiritWidget } from "../widgets/ability";
import { Button } from "../widgets/button";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../main";
import { QuestsMenu } from "./quests";
import { ActiveBattle } from "./battle";
import { Subscription } from "rxjs";
import { NetworkError } from "./network-error";
import { txSpinner } from "../tx-spinner";
import { Color, colorToNumber } from "../constants/colors";
import { ScrollablePanel } from "../widgets/scrollable";
import { addScaledImage } from "../utils/scaleImage";
import { tweenDownAlpha, tweenUpAlpha } from "../utils/tweens";
import { BIOME_ID, biomeToBackground } from "../battle/biome";
import { TOP_BAR_OFFSET, TOP_BAR_WIDTH, TopBar } from "../widgets/top-bar";
import { LevelSelectMenu } from "./level-select";
import { ConfirmOverlay } from "../widgets/confirm-overlay";

const MAX_ABILITIES = 7; // Maximum number of abilities a player can select for a battle

const LAST_LOADOUT_KEY = 'last-loadout';
// TODO: allow multiple configs in the future
const SAVED_CONFIG_KEY = 'saved-loadout';

/// gets the inner Ability from an element of the ability panels
function getAbility(widget: Phaser.GameObjects.GameObject): Ability {
    return ((widget as Phaser.GameObjects.Container).list[0] as AbilityWidget).ability;
}

export class StartBattleMenu extends Phaser.Scene {
    api: DeployedGame2API;
    state: Game2DerivedState;
    loadout: PlayerLoadout;
    subscription: Subscription;
    available: AbilityWidget[];
    startButton: Button | undefined;
    loadButton: Button | undefined;
    loadLastButton: Button | undefined;
    abilitySlots: Phaser.GameObjects.GameObject[];
    isQuest: boolean;
    biome: BIOME_ID;
    difficulty: number;
    spiritPreviews: (SpiritWidget | null)[];
    summoningTablets: Phaser.GameObjects.Image[];
    activeAbilityPanel: ScrollablePanel | undefined;
    inactiveAbilityPanel: ScrollablePanel | undefined;
    battleConfig: BattleConfig | undefined;
    waitingOnState: boolean;
    stateChangeEvent: Phaser.Events.EventEmitter | undefined;

    constructor(api: DeployedGame2API, biome: BIOME_ID, isQuest: boolean, state: Game2DerivedState, difficulty: number = 1) {
        super('StartBattleMenu');
        this.api = api;
        this.loadout = {
            abilities: [],
        };
        this.available = [];
        this.abilitySlots = [];
        this.summoningTablets = [];
        this.spiritPreviews = new Array(MAX_ABILITIES).map((_) => null);
        this.isQuest = isQuest;
        this.biome = biome;
        this.difficulty = difficulty;
        this.state = state;
        this.waitingOnState = true;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
    }

    onStateChange(state: Game2DerivedState) {
        this.state = structuredClone(state);
        this.events.emit('stateChange', state);
    }

    create() {
        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, biomeToBackground(this.biome)).setDepth(-10);

        this.activeAbilityPanel = new ScrollablePanel(this, GAME_WIDTH/2, GAME_HEIGHT * 0.46, GAME_WIDTH*0.96, 128, false);
        this.inactiveAbilityPanel = new ScrollablePanel(this, GAME_WIDTH/2, GAME_HEIGHT * 0.805, GAME_WIDTH*0.96, 128);

        // Shared tooltip for ability cards
        const tooltipText = this.add.text(0, 0, '', fontStyle(10, { wordWrap: { width: GAME_WIDTH * 0.6 } }))
            .setAlpha(0).setVisible(false).setOrigin(0.5, 1).setDepth(1000);
        let tooltipTween: Phaser.Tweens.Tween | null = null;
        const showTooltip = (child: Phaser.GameObjects.GameObject) => {
            const text = child.getData('tooltipText');
            if (!text) return;
            tooltipText.setText(text).setVisible(true);
            tooltipTween?.destroy();
            tooltipTween = this.tweens.add({ targets: tooltipText, alpha: 1, delay: 400, duration: 600 });
        };
        const hideTooltip = () => {
            tooltipText.setVisible(false).setAlpha(0);
            tooltipTween?.destroy();
            tooltipTween = null;
        };
        this.events.on('preupdate', () => {
            if (tooltipText.visible) {
                const mx = this.input.activePointer.worldX;
                const my = this.input.activePointer.worldY;
                tooltipText.setPosition(
                    Phaser.Math.Clamp(mx, tooltipText.width / 2 + 8, GAME_WIDTH - tooltipText.width / 2 - 8),
                    Math.max(my - 16, tooltipText.height + 8)
                );
            }
        });

        const onMovedChild = (panel: ScrollablePanel, child: Phaser.GameObjects.GameObject) => {
            // Determine which abilities are selected
            const activeAbilities = this.getOrderedActiveAbilities();
            this.loadout.abilities = activeAbilities.map((a) => pureCircuits.derive_ability_id(a.ability));

            this.sound.play('prebattle-move-spirit', { volume: 0.6 });

            this.refreshPreviews();

            // Enable the start button if we have enough abilities selected
            this.startButton?.setEnabled(this.loadout.abilities.length == MAX_ABILITIES);
        }
        this.activeAbilityPanel.enableDraggable({
            onMovedChild,
            onDragEnd: () => {
                this.resetAllSlots();
                this.refreshPreviews();
            },
            onDoubleClick: (panel, child) => {
                logger.ui.info('Double-click from active panel');
                this.transferAbilityBetweenPanels(child as Phaser.GameObjects.Container);
            },
            onHover: showTooltip,
            onHoverOut: hideTooltip,
            maxElements: MAX_ABILITIES
        });
        this.inactiveAbilityPanel.enableDraggable({
            onMovedChild,
            onDragEnd: () => {
                this.resetAllSlots()
            },
            onDoubleClick: (panel, child) => {
                logger.ui.info('Double-click from inactive panel');
                this.transferAbilityBetweenPanels(child as Phaser.GameObjects.Container);
            },
            onHover: showTooltip,
            onHoverOut: hideTooltip,
        });

        const abilities = sortedAbilities(this.state);
        for (let i = 0; i < abilities.length; ++i) {
            const ability = abilities[i];

            const abilityWidget = new AbilityWidget(this, 0, 2, ability);
            const abilityContainer = this.add.container(0, 0).setSize(abilityWidget.width, abilityWidget.height);
            abilityContainer.add(abilityWidget);

            abilityContainer.setData('tooltipText', describeAbility(ability));

            // Add new child to scrollable panel
            this.inactiveAbilityPanel.addChild(abilityContainer);

            this.available.push(abilityWidget);
        }

        // Add placeholder slots for active abilities
        this.abilitySlots = [];
        for (let i = 0; i < MAX_ABILITIES; ++i) {
            const x = 61 + (i * 0.98 * GAME_WIDTH/MAX_ABILITIES);
            const y = GAME_HEIGHT * 0.47;
            this.summoningTablets.push(addScaledImage(this, x, y - 116, 'tablet-round').setDepth(1));
            const slot = this.rexUI.add.roundRectangle(x, y, 71, 125, 20, colorToNumber(Color.Purple));
            this.add.existing(slot);
            this.abilitySlots.push(slot);
        }

        // Set up drag-over animations for ability slots
        this.activeAbilityPanel.addDragTargets(this.abilitySlots, {
            onDragOver: (slot) => this.animateSlotEnlarge(slot),
            onDragOut: (slot) => this.animateSlotShrink(slot)
        });
        
        this.inactiveAbilityPanel.addDragTargets(this.abilitySlots, {
            onDragOver: (slot) => this.animateSlotEnlarge(slot),
            onDragOut: (slot) => this.animateSlotShrink(slot)
        });

        const topButtonY = 24;
        const buttonWidth = 128;
        const buttonHeight = 40;
        const buttonFontSize = 10;
        const topBarOffset = TOP_BAR_OFFSET + 2 * (TOP_BAR_OFFSET - TOP_BAR_WIDTH / 2) + 8;
        const remainingWidth = GAME_WIDTH - topBarOffset;
        new TopBar(this, false, this.api, this.state)
            .back(() => {
                this.scene.remove('LevelSelectMenu');
                this.scene.add('LevelSelectMenu', new LevelSelectMenu(this.api!, this.biome, this.isQuest, this.state));
                this.scene.start('LevelSelectMenu');
            }, 'Back to Level Select');
        this.loadLastButton = new Button(this, topBarOffset + remainingWidth * (2.5 / 24), topButtonY, buttonWidth, buttonHeight, 'Use Last', buttonFontSize, () => {
            this.loadCurrentLoadout(LAST_LOADOUT_KEY);
        }, 'Load your most recent spirit loadout');
        new Button(this, topBarOffset + remainingWidth * (7.25 / 24), topButtonY, buttonWidth, buttonHeight, 'Clear', buttonFontSize, () => {
            this.clearSelectedAbilities();
        }, 'Remove all spirits from the deck');

        this.startButton = new Button(this, topBarOffset + remainingWidth * (12 / 24), topButtonY, buttonWidth, buttonHeight, 'Start', buttonFontSize, () => {
            if (this.loadout.abilities.length == MAX_ABILITIES) {
                this.saveCurrentLoadout(LAST_LOADOUT_KEY);
                const level = { biome: BigInt(this.biome), difficulty: BigInt(this.difficulty) };
                if (this.isQuest) {
                    const levelDuration = this.state.questDurations.get(BigInt(this.biome))?.get(BigInt(this.difficulty)) ?? 1200n;
                    const durationMin = Math.ceil(Number(levelDuration > 0n ? levelDuration : 1200n) / 60);
                    new ConfirmOverlay(
                        this,
                        `These spirits will be locked for ${durationMin} minutes.\nYou can continue playing - but these spirits\nwill not be usable until the time passes\nand you face the boss.`,
                        () => {
                            txSpinner.show("Generating Proof");
                            this.input.enabled = false;
                            this.api.start_new_quest(this.loadout, level).then((questId) => {
                                txSpinner.hide();
                                this.input.enabled = true;
                                this.scene.remove('QuestsMenu');
                                this.scene.add('QuestsMenu', new QuestsMenu(this.api!, this.state));
                                this.scene.start('QuestsMenu');
                            });
                        },
                        () => {} // cancel - do nothing
                    );
                } else {
                    // Start a new battle
                    logger.gameState.info(`starting new battle...`);
                    txSpinner.show("Generating Proof");
                    this.input.enabled = false;
                    this.stateChangeEvent = this.events.on('stateChange', (state: Game2DerivedState) => {
                        this.state = state;
                        this.waitingOnState = false;
                        this.tryStartBattle();
                    });
                    this.api.start_new_battle(this.loadout, level).then((battle) => {
                        txSpinner.show("Waiting Transaction");
                        this.battleConfig = battle;
                        this.tryStartBattle();
                    }).catch((e) => {
                        logger.network.error(`Error starting battle: ${e}`);
                        txSpinner.hide();
                        this.input.enabled = true;

                        // Show network error overlay
                        if (!this.scene.get('NetworkError')) {
                            this.scene.add('NetworkError', new NetworkError());
                        }
                        const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
                        networkErrorScene.setErrorMessage('Error starting battle. Please try again.');
                        this.scene.launch('NetworkError');
                    });
                }
            } else {
                logger.ui.warn(`finish selecting abilities (selected ${this.loadout.abilities.length}, need 7)`);
            }
        }, 'Begin the battle (requires 7 spirits)').setEnabled(false);

        this.loadButton = new Button(this, topBarOffset + remainingWidth * (16.75 / 24), topButtonY, buttonWidth, buttonHeight, 'Load', buttonFontSize, () => {
            this.loadCurrentLoadout(SAVED_CONFIG_KEY);
        }, 'Load a saved spirit loadout');
        new Button(this, topBarOffset + remainingWidth * (21.5 / 24), topButtonY, buttonWidth, buttonHeight, 'Save', buttonFontSize, () => {
            this.saveCurrentLoadout(SAVED_CONFIG_KEY);
        }, 'Save this loadout for later');
        this.enableLoadButtons();
    }

    private tryStartBattle() {
        if (this.battleConfig != undefined && !this.waitingOnState) {
            logger.combat.debug('stateChange event fired, creating ActiveBattle');
            txSpinner.hide();
            this.input.enabled = true;
            // Clean up shared dungeon scene when entering battle
            if (this.scene.get('DungeonScene')) {
                this.scene.stop('DungeonScene');
                this.scene.remove('DungeonScene');
            }
            this.stateChangeEvent?.destroy();
            this.scene.remove('ActiveBattle');
            this.scene.add('ActiveBattle', new ActiveBattle(this.api, this.battleConfig, this.state));
            this.scene.start('ActiveBattle');
        }
    }

    private clearSelectedAbilities() {
        this.activeAbilityPanel?.getChildren().forEach((c) => {
            this.activeAbilityPanel?.moveChildTo(c, this.inactiveAbilityPanel!);
        });
    }

    private loadCurrentLoadout(key: string) {
        const raw = localStorage.getItem(key);
        if (raw != null) {
            this.clearSelectedAbilities();
            const ids: bigint[] = raw.split(',').map((s) => BigInt(s));
            const children: Phaser.GameObjects.GameObject[] = [];

            // Track how many of each ability type we've already consumed
            const consumedCounts = new Map<bigint, number>();
            const inactiveChildren = this.inactiveAbilityPanel?.getChildren() || [];

            for (const targetId of ids) {
                const currentConsumed = consumedCounts.get(targetId) || 0;

                // Find the (currentConsumed+1)th occurrence of this ability type
                let foundCount = 0;
                const matchingChild = inactiveChildren.find((c) => {
                    const abilityId = pureCircuits.derive_ability_id(getAbility(c));
                    if (abilityId === targetId) {
                        foundCount++;
                        return foundCount === currentConsumed + 1;
                    }
                    return false;
                });

                if (matchingChild) {
                    children.push(matchingChild);
                    consumedCounts.set(targetId, currentConsumed + 1);
                }
            }

            logger.ui.info(`Loaded ${children.length} / ${ids.length} abilities from '${key}'`);
            children.forEach((c) => this.transferAbilityBetweenPanels(c as Phaser.GameObjects.Container));
        }
    }

    private saveCurrentLoadout(key: string) {
        const ids = this
                .activeAbilityPanel!
                .getChildren()
                .map((c) => pureCircuits.derive_ability_id(getAbility(c)));
                logger.ui.info(`Saved ${ids.length} abilities to '${key}'`);
        localStorage.setItem(key, ids.join(','));
        // possibly enable after saving
        this.enableLoadButtons();
    }

    private enableLoadButtons() {
        this.loadButton!.setEnabled(localStorage.getItem(SAVED_CONFIG_KEY) != null);
        this.loadLastButton!.setEnabled(localStorage.getItem(LAST_LOADOUT_KEY) != null);
    }

    private animateSlotEnlarge(slot: Phaser.GameObjects.GameObject) {
        this.tweens.add({
            targets: slot,
            scaleX: 1.2,
            scaleY: 1.2,
            alpha: 0.8,
            duration: 200,
            ease: 'Power2'
        });
    }

    private animateSlotShrink(slot: Phaser.GameObjects.GameObject) {
        this.tweens.add({
            targets: slot,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            duration: 200,
            ease: 'Power2'
        });
    }

    private resetAllSlots() {
        this.abilitySlots.forEach(slot => {
            // Always shrink and reset hover state, regardless of current hover state
            this.animateSlotShrink(slot);
            (slot as any).setData('isHovered', false);
        });
    }

    private refreshPreviews() {
        const activeAbilities = this.getOrderedActiveAbilities();
        for (let i = 0; i < MAX_ABILITIES; ++i) {
            const newAbility = activeAbilities.at(i)?.ability;
            if (this.spiritPreviews[i]?.ability != newAbility) {
                let tweens = [];
                // destroy old
                const oldPreview = this.spiritPreviews[i];
                if (oldPreview != null) {
                    tweens.push({
                        ...tweenDownAlpha(oldPreview),
                        onComplete: () => {
                            oldPreview.destroy();
                        },
                    });
                }
                // create new
                if (newAbility != undefined) {
                    const tablet = this.summoningTablets[i];
                    const newPreview = new SpiritWidget(this, tablet.x, tablet.y - 24, newAbility)
                                .setDepth(2)
                                .setAlpha(0);
                    this.spiritPreviews[i] = newPreview;
                    tweens.push({
                        ...tweenUpAlpha(newPreview),
                    });
                } else {
                    // Clear reference if no new ability
                    this.spiritPreviews[i] = null;
                }
                if (tweens.length > 0) {
                    this.tweens.chain({
                        targets: this, // this doesn't seem to do anything (always overridden?) but if you pass null it errors
                        tweens,
                    });
                }
            }
        }
    }

    private transferAbilityBetweenPanels(abilityContainer: Phaser.GameObjects.Container) {
        logger.ui.info('Transfer called for container:', abilityContainer);
        
        if (this.activeAbilityPanel?.hasChild(abilityContainer)) {
            // Move from active to inactive panel
            logger.ui.info('Moving from active to inactive');
            this.sound.play('prebattle-move-spirit', { volume: 0.6 });
            this.activeAbilityPanel.moveChildTo(abilityContainer, this.inactiveAbilityPanel!);
        } else if (this.inactiveAbilityPanel?.hasChild(abilityContainer)) {
            // Move from inactive to active panel (if there's room)
            if (this.activeAbilityPanel!.getChildCount() < MAX_ABILITIES) {
                logger.ui.info('Moving from inactive to active');
                this.sound.play('prebattle-move-spirit', { volume: 0.6 });
                this.inactiveAbilityPanel.moveChildTo(abilityContainer, this.activeAbilityPanel!);
            } else {
                logger.ui.warn('Cannot move to active panel - at max capacity');
            }
        } else {
            logger.ui.warn('Container not found in either panel');
        }
    }

    private getOrderedActiveAbilities(): AbilityWidget[] {
        return this
            .activeAbilityPanel!
            .getChildren()
            .map((widget) => (widget as Phaser.GameObjects.Container))
            .map(((container) => container.list[0] as AbilityWidget));
    }

    shutdown() {
        this.subscription?.unsubscribe();
    }
}

// TODO: is this a performance issue?
export const isStartingAbility = (ability: Ability) => {
    const id = pureCircuits.derive_ability_id(ability);
    const phys_id = pureCircuits.derive_ability_id(pureCircuits.ability_base_phys());
    const block_id = pureCircuits.derive_ability_id(pureCircuits.ability_base_block());
    return id == phys_id || id == block_id;
};

export function sortedAbilitiesById(state: Game2DerivedState): bigint[] {
    let abilities = [];
    for (const [id, count] of state.playerAbilities) {
        for (let i = 0; i < count; ++i) {
            abilities.push(id);
        }
    }
    return abilities.sort((a, b) => Number(pureCircuits.ability_score(state.allAbilities.get(b)!) - pureCircuits.ability_score(state.allAbilities.get(a)!)));
}

export function sortedAbilities(state: Game2DerivedState): Ability[] {
    return sortedAbilitiesById(state).map((id) => state.allAbilities.get(id)!);
}
