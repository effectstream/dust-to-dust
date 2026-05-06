import { DeployedGame2API, Game2DerivedState, safeJSONString } from "game2-api";
import { Ability, pureCircuits } from "game2-contract";
import { Subscription } from "rxjs";
import { AbilityWidget, SpiritWidget } from "../../widgets/ability";
import { createSpiritAnimations } from "../../animations/spirit";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../../main";
import { Button } from "../../widgets/button";
import { NetworkError } from "../network-error";
import { txSpinner } from "../../tx-spinner";
import { Color, colorToNumber } from "../../constants/colors";
import { isStartingAbility, sortedAbilities } from "../pre-battle";
import { addScaledImage } from "../../utils/scaleImage";
import { ScrollablePanel } from "../../widgets/scrollable";
import { TopBar } from "../../widgets/top-bar";
import { addTooltip, Tooltip } from "../../widgets/tooltip";
import { ShopMenu } from "./shop";
import { UpgradeSparkleParticleSystem } from "../../particles/upgrade-sparkle";
import { SacrificeDissolveParticleSystem } from "../../particles/sacrifice-dissolve";
import { UpgradeSuccessScreen } from "./upgrade-success";
import { abilityValue } from "../../battle/logic";

// Enums
enum SlotType {
    Upgrading = 'upgrading',
    Sacrificing = 'sacrificing'
}

// Constants
const UNUPGRADEABLE_TOOLTIP_TEXT = "Starting spirits cannot be used for upgrading";
const MAX_UPGRADE_LEVEL = 3;
const FULLY_UPGRADED_TOOLTIP_TEXT = "Spirit is fully upgraded";
const INSUFFICIENT_VALUE_TOOLTIP_TEXT = "Spirit value too low for upgrading ability";

// Layout constants
const STAR_SPACING = 20;
const STAR_Y_OFFSET = -85;
const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 160;
const SLOT_Y_RATIO = 0.35;
const SLOT_LEFT_X_RATIO = 0.3;
const SLOT_RIGHT_X_RATIO = 0.7;
const SLOT_TITLE_OFFSET_Y = 115;
const SLOT_SPIRIT_OFFSET_X = 100;
const SLOT_PROXIMITY_THRESHOLD = 150;

const PANEL_WIDTH_RATIO = 0.95;
const PANEL_HEIGHT = 175;
const PANEL_Y_RATIO = 0.75;

const BUTTON_WIDTH = 150;
const BUTTON_HEIGHT = 60;
const BUTTON_Y_RATIO = 0.34;
const BUTTON_FONT_SIZE = 12;

const TOOLTIP_WIDTH = 300;
const TOOLTIP_HEIGHT = 400;

// Helper function to get ability upgrade level
function getAbilityUpgradeLevel(ability: Ability): number {
    return Number(ability.upgrade_level);
}

export class UpgradeSpiritsMenu extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription;
    state: Game2DerivedState;
    ui: Phaser.GameObjects.GameObject[];
    topBar: TopBar | undefined;
    errorText: Phaser.GameObjects.Text | undefined;

    upgradingSlot: Phaser.GameObjects.GameObject | undefined;
    sacrificingSlot: Phaser.GameObjects.GameObject | undefined;
    sacrificingSlotTitle: Phaser.GameObjects.Text | undefined;
    upgradingSpirit: Ability | undefined;
    sacrificingSpirit: Ability | undefined;
    upgradingSpiritContainer: Phaser.GameObjects.Container | undefined;
    sacrificingSpiritContainer: Phaser.GameObjects.Container | undefined;
    upgradeButton: Button | undefined;
    upgradeCostLabel: Phaser.GameObjects.Text | undefined;
    upgradeCostAmount: Phaser.GameObjects.Text | undefined;
    upgradeButtonTooltip: Tooltip | undefined;

    spiritPanel: ScrollablePanel | undefined;

    pendingUpgradedAbilityId: bigint | undefined;
    showingSuccessScreen: boolean = false;

    constructor(api: DeployedGame2API, state: Game2DerivedState) {
        super("UpgradeSpiritsMenu");

        this.api = api;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
        this.state = state;
        this.ui = [];
    }

    create() {
        this.errorText = this.add.text(82, GAME_HEIGHT * 0.5, '', fontStyle(12, { color: Color.Red })).setStroke(Color.Licorice, 6);
        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg-shop').setDepth(-10);
        createSpiritAnimations(this);

        this.topBar = new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('ShopMenu');
                this.scene.add('ShopMenu', new ShopMenu(this.api, this.state));
                this.scene.start('ShopMenu');
            }, 'Back to Shop');

        this.createUpgradeSlots();
        this.createSpiritsPanel();

        this.upgradeButton = new Button(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT * BUTTON_Y_RATIO,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Upgrade',
            BUTTON_FONT_SIZE,
            () => this.performUpgrade()
        ).setEnabled(false);

        const costY = GAME_HEIGHT * BUTTON_Y_RATIO + BUTTON_HEIGHT / 2;
        this.upgradeCostLabel = this.add.text(
            GAME_WIDTH / 2 - 80, 
            costY,
            'Cost: ',
            fontStyle(10, { color: Color.White })
        ).setVisible(false).setStroke(Color.Licorice, 4);

        this.upgradeCostAmount = this.add.text(
            GAME_WIDTH / 2 - 15,
            costY,
            '',
            fontStyle(10, { color: Color.Yellow })
        ).setVisible(false).setStroke(Color.Licorice, 4);

        this.onStateChange(this.state);
    }

    shutdown() {
        this.subscription?.unsubscribe();
    }

    private createUpgradeSlots() {
        const slotY = GAME_HEIGHT * SLOT_Y_RATIO;

        this.upgradingSlot = this.rexUI.add.roundRectangle(
            GAME_WIDTH * SLOT_LEFT_X_RATIO,
            slotY,
            SLOT_WIDTH,
            SLOT_HEIGHT,
            20,
            colorToNumber(Color.Blue)
        );
        this.add.existing(this.upgradingSlot);
        this.upgradingSlot.setInteractive().setData('slotType', SlotType.Upgrading);

        this.add.text(GAME_WIDTH * SLOT_LEFT_X_RATIO, slotY - SLOT_TITLE_OFFSET_Y, 'Upgrading Spirit',
            fontStyle(10, { color: Color.White })).setStroke(Color.Licorice, 6).setOrigin(0.5);

        this.sacrificingSlot = this.rexUI.add.roundRectangle(
            GAME_WIDTH * SLOT_RIGHT_X_RATIO,
            slotY,
            SLOT_WIDTH,
            SLOT_HEIGHT,
            20,
            colorToNumber(Color.Red)
        );
        this.add.existing(this.sacrificingSlot);
        this.sacrificingSlot.setInteractive().setData('slotType', SlotType.Sacrificing);

        this.sacrificingSlotTitle = this.add.text(
            GAME_WIDTH * SLOT_RIGHT_X_RATIO,
            slotY - SLOT_TITLE_OFFSET_Y,
            'Sacrificing Spirit',
            fontStyle(10, { color: Color.White })
        ).setStroke(Color.Licorice, 6).setOrigin(0.5);

        // Initially hide the sacrificing slot and title
        (this.sacrificingSlot as any).setVisible(false);
        this.sacrificingSlotTitle.setVisible(false);
    }

    private createSpiritsPanel() {
        this.spiritPanel = new ScrollablePanel(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT * PANEL_Y_RATIO,
            GAME_WIDTH * PANEL_WIDTH_RATIO,
            PANEL_HEIGHT,
            true,
            { bottom: 0 }
        );
        this.ui.push(this.spiritPanel.panel);

        this.spiritPanel.enableDraggable({});

        this.spiritPanel.addDragTargets([this.upgradingSlot!, this.sacrificingSlot!], {
            onDragOver: (slot) => this.animateSlotEnlarge(slot),
            onDragOut: (slot) => this.animateSlotShrink(slot)
        });

        this.setupSlotDropZones();
    }

    private setupSlotDropZones() {
        this.upgradingSlot?.setInteractive().setData('drop', true);
        this.sacrificingSlot?.setInteractive().setData('drop', true);

        this.input.on('dragend', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject, dropped: boolean) => {
            logger.ui.debug(`Dragend event: dropped=${dropped}, pointer=(${pointer.x}, ${pointer.y})`);

            if (!dropped) {
                const dragEndX = pointer.x;
                const dragEndY = pointer.y;

                if (this.upgradingSlot) {
                    const upgradingBounds = (this.upgradingSlot as any).getBounds();
                    logger.ui.debug(`Upgrading slot bounds:`, upgradingBounds);

                    if (Phaser.Geom.Rectangle.Contains(upgradingBounds, dragEndX, dragEndY)) {
                        logger.ui.debug('Drag ended over upgrading slot');
                        this.handleSpiritDropOnSlot(SlotType.Upgrading, gameObject);
                        this.animateSlotShrink(this.upgradingSlot);
                        return;
                    }
                }

                if (this.sacrificingSlot) {
                    const sacrificingBounds = (this.sacrificingSlot as any).getBounds();
                    logger.ui.debug(`Sacrificing slot bounds:`, sacrificingBounds);

                    if (Phaser.Geom.Rectangle.Contains(sacrificingBounds, dragEndX, dragEndY)) {
                        logger.ui.debug('Drag ended over sacrificing slot');
                        this.handleSpiritDropOnSlot(SlotType.Sacrificing, gameObject);
                        this.animateSlotShrink(this.sacrificingSlot);
                        return;
                    }
                }

                logger.ui.debug('Drag ended outside of slots');
            } else {
                logger.ui.debug('Spirit was dropped on a drop zone (not our slots)');
            }
        });
    }

    private handleSpiritDropOnSlot(slotType: SlotType, draggedObject: any) {
        logger.ui.info(`Spirit dropped on ${slotType} slot`);
        logger.ui.debug('Dropped object type:', draggedObject.constructor.name);

        const spiritContainer = this.extractSpiritContainer(draggedObject);
        if (!spiritContainer) return;

        let ability: Ability;
        try {
            ability = this.getAbilityFromContainer(spiritContainer);
        } catch (error) {
            logger.ui.error('Failed to extract ability from container:', error);
            return;
        }

        if (isStartingAbility(ability)) {
            logger.ui.warn('Cannot use starting abilities for upgrading');
            return;
        }

        const upgradeLevel = getAbilityUpgradeLevel(ability);
        if (upgradeLevel >= MAX_UPGRADE_LEVEL) {
            logger.ui.warn('Cannot upgrade fully upgraded abilities');
            return;
        }

        // Don't allow placing in sacrificing slot if no upgrading spirit is present
        if (slotType === SlotType.Sacrificing && !this.upgradingSpirit) {
            logger.ui.warn('Must select an upgrading spirit first');
            return;
        }

        // Check value constraints when placing in sacrificing slot
        if (slotType === SlotType.Sacrificing && this.upgradingSpirit) {
            const upgradingValue = pureCircuits.ability_score(this.upgradingSpirit);
            const sacrificingValue = pureCircuits.ability_score(ability);
            if (sacrificingValue < upgradingValue) {
                logger.ui.warn('Sacrificing ability value too low');
                return;
            }
        }

        // Check value constraints when placing in upgrading slot (if sacrificing already placed)
        if (slotType === SlotType.Upgrading && this.sacrificingSpirit) {
            const upgradingValue = pureCircuits.ability_score(ability);
            const sacrificingValue = pureCircuits.ability_score(this.sacrificingSpirit);
            if (sacrificingValue < upgradingValue) {
                logger.ui.warn('Sacrificing ability value too low for this upgrading spirit');
                return;
            }
        }

        if (slotType === SlotType.Upgrading && this.upgradingSpirit) {
            logger.ui.info('Upgrading slot is occupied, replacing existing spirit');
            this.removeFromUpgradingSlot();
        }

        if (slotType === SlotType.Sacrificing && this.sacrificingSpirit) {
            logger.ui.info('Sacrificing slot is occupied, replacing existing spirit');
            this.removeFromSacrificingSlot();
        }

        if (slotType === SlotType.Upgrading && this.sacrificingSpiritContainer === spiritContainer) {
            logger.ui.warn('Cannot use the same spirit instance for both slots');
            return;
        }

        if (slotType === SlotType.Sacrificing && this.upgradingSpiritContainer === spiritContainer) {
            logger.ui.warn('Cannot use the same spirit instance for both slots');
            return;
        }

        this.removeFromScrollablePanel(spiritContainer);

        if (slotType === SlotType.Upgrading) {
            this.placeSpiritInUpgradingSlot(spiritContainer, ability);
        } else {
            this.placeSpiritInSacrificingSlot(spiritContainer, ability);
        }
    }

    private extractSpiritContainer(draggedObject: any): Phaser.GameObjects.Container | null {
        if (draggedObject.type === 'rexFixWidthSizer') {
            const children = draggedObject.getAll();
            if (children.length > 0) {
                const container = children[0] as Phaser.GameObjects.Container;
                logger.ui.debug('Unwrapped container type:', container.constructor.name);
                return container;
            } else {
                logger.ui.error('FixWidthSizer has no children');
                return null;
            }
        } else if (draggedObject instanceof Phaser.GameObjects.Container) {
            return draggedObject;
        } else {
            logger.ui.error('Unknown dragged object type:', draggedObject);
            return null;
        }
    }

    private removeFromScrollablePanel(spiritContainer: Phaser.GameObjects.Container) {
        if (!this.spiritPanel || !this.spiritPanel.hasChild(spiritContainer)) return;

        const sizer = this.spiritPanel.getPanelElement();
        const items = (sizer as any).getElement?.('items');

        if (items && Array.isArray(items)) {
            const wrappedChildIndex = items.findIndex((item: any) => {
                const children = item.getAll();
                return children.length > 0 && children[0] === spiritContainer;
            });

            if (wrappedChildIndex !== -1) {
                const wrappedChild = items[wrappedChildIndex];
                (sizer as any).remove(wrappedChild);
                this.spiritPanel.panel.layout();
                spiritContainer.destroy();
            }
        }
    }

    private onStateChange(state: Game2DerivedState) {
        logger.gameState.debug(`UpgradeSpiritsMenu.onStateChange(): ${safeJSONString(state)}`);

        this.state = structuredClone(state);

        // Check if we're waiting for an upgraded ability to appear in state
        if (this.pendingUpgradedAbilityId !== undefined) {
            const upgradedAbility = state.allAbilities.get(this.pendingUpgradedAbilityId);
            if (upgradedAbility !== undefined) {
                // Both circuit call and state update are complete!
                logger.ui.info('Upgrade complete - upgraded ability found in state');
                this.pendingUpgradedAbilityId = undefined;

                // Hide spinner
                txSpinner.hide();
                this.input.enabled = true;

                // Show upgrade success screen first
                this.showingSuccessScreen = true;
                this.scene.pause();

                // Remove old success screen if it exists
                const existingSuccessScreen = this.scene.get('UpgradeSuccessScreen');
                if (existingSuccessScreen) {
                    this.scene.remove('UpgradeSuccessScreen');
                }

                // Add and start fresh success screen
                this.scene.add('UpgradeSuccessScreen', new UpgradeSuccessScreen(upgradedAbility), true);

                // Play upgrade animations after success screen is closed
                this.scene.get('UpgradeSuccessScreen')?.events.once('shutdown', () => {
                    this.showingSuccessScreen = false;
                    this.playUpgradeAnimation();
                    this.playSacrificeAnimation();
                    // Rebuild panel to refresh grayed-out states
                    this.rebuildSpiritsPanel();
                });

                // Clear the slots
                this.upgradingSpirit = undefined;
                this.sacrificingSpirit = undefined;
                this.upgradingSpiritContainer = undefined;
                this.sacrificingSpiritContainer = undefined;

                // Hide sacrificing slot
                (this.sacrificingSlot as any)?.setVisible(false);
                this.sacrificingSlotTitle?.setVisible(false);

                // Clear slot UI
                if (this.upgradingSlot) {
                    this.removeSlotSpirit(this.upgradingSlot);
                }
                if (this.sacrificingSlot) {
                    this.removeSlotSpirit(this.sacrificingSlot);
                }

                this.checkUpgradeButtonState();
            } else {
                logger.ui.debug('State updated but upgraded ability not yet in allAbilities');
            }
        }

        // Rebuild panel on state changes (e.g., after API calls)
        this.rebuildSpiritsPanel();
    }

    private rebuildSpiritsPanel() {
        // Don't rebuild if showing success screen (scene is paused/invalid)
        if (this.showingSuccessScreen) {
            return;
        }

        // Destroy the old panel and create a new one (only for state changes)
        if (this.spiritPanel) {
            this.spiritPanel.panel.destroy();
        }

        this.spiritPanel = new ScrollablePanel(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT * PANEL_Y_RATIO,
            GAME_WIDTH * PANEL_WIDTH_RATIO,
            PANEL_HEIGHT,
            true,
            { bottom: 0 }
        );
        this.ui.push(this.spiritPanel.panel);

        // Re-setup drag targets for the new panel
        this.spiritPanel.addDragTargets([this.upgradingSlot!, this.sacrificingSlot!], {
            onDragOver: (slot) => this.animateSlotEnlarge(slot),
            onDragOut: (slot) => this.animateSlotShrink(slot)
        });

        this.spiritPanel.enableDraggable({
            onMovedChild: () => {},
            onDragEnd: () => {},
            onDragStart: (child: any) => {
                // Get the container from the dragged child
                const container = this.extractSpiritContainer(child);
                if (!container) return;

                // Check if this spirit is unusable
                const isStarting = (container as any).__isStarting as boolean;
                const isFullyUpgraded = (container as any).__isFullyUpgraded as boolean;
                const abilityValue = (container as any).__abilityValue as bigint;
                const upgradingValue = this.upgradingSpirit ? pureCircuits.ability_score(this.upgradingSpirit) : undefined;
                const hasInsufficientValue = upgradingValue !== undefined && abilityValue < upgradingValue;

                const isUnusable = isStarting || isFullyUpgraded || hasInsufficientValue;

                // Cancel drag if spirit is unusable
                if (isUnusable) {
                    logger.ui.warn('Cannot drag unusable spirit');
                    return false;
                }
            }
        });

        // Get sorted abilities once
        const abilities = this.sortedAbilitiesWithStartingLast(this.state);
        const upgradingValue = this.upgradingSpirit ? pureCircuits.ability_score(this.upgradingSpirit) : undefined;

        // Single pass through abilities
        for (const ability of abilities) {
            const { isUnusable, tooltipText } = this.getAbilityUsability(ability, upgradingValue);
            this.addAbilityToPanel(ability, isUnusable, tooltipText);
        }
    }

    // Efficiently update panel item states without rebuilding
    private updatePanelItemStates() {
        const items = this.getPanelItems();
        if (!items) return;

        const upgradingValue = this.upgradingSpirit ? pureCircuits.ability_score(this.upgradingSpirit) : undefined;

        for (const wrappedItem of items) {
            // Fast path: use cached values to avoid expensive lookups and calculations
            const container = this.unwrapContainer(wrappedItem);
            if (!container) continue;

            const abilityWidget = (container as any).__abilityWidget as AbilityWidget;
            if (!abilityWidget) continue;

            // Use cached values for instant comparison (no bigint calculations)
            const isStarting = (container as any).__isStarting as boolean;
            const isFullyUpgraded = (container as any).__isFullyUpgraded as boolean;
            const abilityValue = (container as any).__abilityValue as bigint;

            const hasInsufficientValue = upgradingValue !== undefined && abilityValue < upgradingValue;
            const isUnusable = isStarting || isFullyUpgraded || hasInsufficientValue;

            // Update visual state
            abilityWidget.setAlpha(isUnusable ? 0.5 : 1);

            // Update tooltip
            let tooltipText: string | null = null;
            if (isStarting) {
                tooltipText = UNUPGRADEABLE_TOOLTIP_TEXT;
            } else if (isFullyUpgraded) {
                tooltipText = FULLY_UPGRADED_TOOLTIP_TEXT;
            } else if (hasInsufficientValue) {
                tooltipText = INSUFFICIENT_VALUE_TOOLTIP_TEXT;
            }

            // Destroy old tooltip if it exists
            const oldTooltip = (container as any).__tooltip;
            if (oldTooltip) {
                oldTooltip.destroy();
                (container as any).__tooltip = undefined;
            }

            // Add new tooltip if needed
            if (tooltipText) {
                const tooltip = addTooltip(this, abilityWidget, tooltipText, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
                (container as any).__tooltip = tooltip;
            }
        }
    }

    // Helper to determine if an ability is usable and why
    private getAbilityUsability(ability: Ability, upgradingValue?: bigint): { isUnusable: boolean, tooltipText: string | null } {
        const isStarting = isStartingAbility(ability);
        const upgradeLevel = getAbilityUpgradeLevel(ability);
        const isFullyUpgraded = upgradeLevel >= MAX_UPGRADE_LEVEL;
        const hasInsufficientValue = upgradingValue !== undefined &&
            pureCircuits.ability_score(ability) < upgradingValue;

        const isUnusable = isStarting || isFullyUpgraded || hasInsufficientValue;

        let tooltipText: string | null = null;
        if (isStarting) {
            tooltipText = UNUPGRADEABLE_TOOLTIP_TEXT;
        } else if (isFullyUpgraded) {
            tooltipText = FULLY_UPGRADED_TOOLTIP_TEXT;
        } else if (hasInsufficientValue) {
            tooltipText = INSUFFICIENT_VALUE_TOOLTIP_TEXT;
        }

        return { isUnusable, tooltipText };
    }


    // Helper to get panel items directly (avoiding expensive getChildren())
    private getPanelItems(): any[] | null {
        if (!this.spiritPanel) return null;
        const sizer = this.spiritPanel.getPanelElement();
        const items = (sizer as any).getElement?.('items');
        return items && Array.isArray(items) ? items : null;
    }

    // Helper to unwrap a container from a wrapped item
    private unwrapContainer(wrappedItem: any): Phaser.GameObjects.Container | null {
        const children = wrappedItem.getAll();
        return children.length > 0 ? children[0] as Phaser.GameObjects.Container : null;
    }

    // Helper to create ability container with stars for panel (always at 0,0)
    private createAbilityContainerWithStars(ability: Ability): {
        container: Phaser.GameObjects.Container,
        abilityWidget: AbilityWidget,
        stars: Phaser.GameObjects.Image[]
    } {
        const upgradeLevel = getAbilityUpgradeLevel(ability);
        const abilityWidget = new AbilityWidget(this, 0, 0, ability);

        const stars = this.createUpgradeStars(0, 0, upgradeLevel);

        // Calculate container bounds to include both widget and stars
        const containerHeight = abilityWidget.height + Math.abs(STAR_Y_OFFSET) / 2;

        const abilityContainer = this.add.container(0, 0).setSize(abilityWidget.width, containerHeight);
        abilityContainer.add(abilityWidget);
        abilityContainer.add(stars);

        // Cache references on the container for fast access (avoid expensive lookups)
        (abilityContainer as any).__abilityWidget = abilityWidget;
        (abilityContainer as any).__abilityValue = pureCircuits.ability_score(ability);
        (abilityContainer as any).__isStarting = isStartingAbility(ability);
        (abilityContainer as any).__isFullyUpgraded = upgradeLevel >= MAX_UPGRADE_LEVEL;
        (abilityContainer as any).__tooltip = undefined; // Will be set when tooltip is added

        return { container: abilityContainer, abilityWidget, stars };
    }

    // Helper to get slot position
    private getSlotPosition(slot: Phaser.GameObjects.GameObject): { x: number, y: number } {
        return { x: (slot as any).x, y: (slot as any).y };
    }


    // Helper function to create star indicators above an ability
    private createUpgradeStars(
        x: number,
        y: number,
        upgradeLevel: number
    ): Phaser.GameObjects.Image[] {
        const stars: Phaser.GameObjects.Image[] = [];
        const starStartX = -(MAX_UPGRADE_LEVEL - 1) * STAR_SPACING / 2;

        const starBackground = addScaledImage(this, x, y + STAR_Y_OFFSET, 'upgrade-star-background');
        stars.push(starBackground);
        
        for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) {
            const starX = x + starStartX + i * STAR_SPACING;
            const starImage = i < upgradeLevel ? 'upgrade-star' : 'upgrade-star-slot';
            const star = addScaledImage(this, starX, y + STAR_Y_OFFSET, starImage);
            stars.push(star);
        }

        return stars;
    }

    // Returns a spirit to the panel, maintaining starting abilities and fully upgraded at the end
    private returnSpiritToPanel(ability: Ability) {
        if (!this.spiritPanel) return;

        const { container } = this.createAbilityContainerWithStars(ability);
        const isStarting = (container as any).__isStarting as boolean;
        const isFullyUpgraded = (container as any).__isFullyUpgraded as boolean;

        // Insert before disabled abilities (fully upgraded and starting) if this is usable
        if (!isStarting && !isFullyUpgraded) {
            const items = this.getPanelItems();
            if (items) {
                let insertIndex = items.length;

                // Use cached values for fast lookup (no function calls or widget searches)
                for (let i = 0; i < items.length; i++) {
                    const itemContainer = this.unwrapContainer(items[i]);
                    if (!itemContainer) continue;

                    if ((itemContainer as any).__isFullyUpgraded === true || (itemContainer as any).__isStarting === true) {
                        insertIndex = i;
                        break;
                    }
                }

                const sizer = this.spiritPanel.getPanelElement();
                const wrappedChild = this.rexUI.add.fixWidthSizer({}).add(container);
                (sizer as any).insert(insertIndex, wrappedChild, { expand: true });
                this.spiritPanel.panel.layout();
                return;
            }
        }

        // If it's a disabled ability or we couldn't find the insertion point, just append
        this.spiritPanel.addChild(container);
    }


    private addAbilityToPanel(ability: Ability, greyedOut: boolean, tooltipText: string | null) {
        const { container, abilityWidget } = this.createAbilityContainerWithStars(ability);

        if (greyedOut) {
            abilityWidget.setAlpha(0.5);
            if (tooltipText) {
                const tooltip = addTooltip(this, abilityWidget, tooltipText, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
                (container as any).__tooltip = tooltip;
            }
        }

        this.spiritPanel?.addChild(container);
    }

    private placeSpiritInSlot(
        slotType: SlotType,
        spiritContainer: Phaser.GameObjects.Container,
        ability: Ability
    ) {
        const isUpgrading = slotType === SlotType.Upgrading;
        const slot = isUpgrading ? this.upgradingSlot! : this.sacrificingSlot!;
        const { x: slotX, y: slotY } = this.getSlotPosition(slot);

        // Store spirit reference
        if (isUpgrading) {
            this.upgradingSpirit = ability;
            this.upgradingSpiritContainer = spiritContainer;
        } else {
            this.sacrificingSpirit = ability;
            this.sacrificingSpiritContainer = spiritContainer;
        }

        // Create widgets at slot position (not using helper since we need absolute positioning)
        const abilityWidget = new AbilityWidget(this, slotX, slotY, ability);
        this.setupSlotWidgetInteractivity(abilityWidget, () => {
            isUpgrading ? this.removeFromUpgradingSlot() : this.removeFromSacrificingSlot();
        });

        const spiritOffsetX = isUpgrading ? -SLOT_SPIRIT_OFFSET_X : SLOT_SPIRIT_OFFSET_X;
        const spiritWidget = new SpiritWidget(this, slotX + spiritOffsetX, slotY, ability);

        const upgradeLevel = getAbilityUpgradeLevel(ability);
        const stars = this.createUpgradeStars(slotX, slotY, upgradeLevel);

        this.ui.push(abilityWidget, spiritWidget, ...stars);
        this.checkUpgradeButtonState();

        // Show sacrificing slot when upgrading spirit is placed
        if (isUpgrading) {
            (this.sacrificingSlot as any)?.setVisible(true);
            this.sacrificingSlotTitle?.setVisible(true);
            this.updatePanelItemStates();
        }
    }

    private placeSpiritInUpgradingSlot(spiritContainer: Phaser.GameObjects.Container, ability: Ability) {
        this.placeSpiritInSlot(SlotType.Upgrading, spiritContainer, ability);
    }

    private placeSpiritInSacrificingSlot(spiritContainer: Phaser.GameObjects.Container, ability: Ability) {
        this.placeSpiritInSlot(SlotType.Sacrificing, spiritContainer, ability);
    }

    private setupSlotWidgetInteractivity(widget: AbilityWidget, onClick: () => void) {
        widget.setInteractive()
            .on('pointerover', () => {
                (this.game.canvas as HTMLCanvasElement).style.cursor = 'pointer';
            })
            .on('pointerout', () => {
                (this.game.canvas as HTMLCanvasElement).style.cursor = 'default';
            })
            .on('pointerdown', () => {
                onClick();
                // Reset cursor after click since widget will be destroyed
                (this.game.canvas as HTMLCanvasElement).style.cursor = 'default';
            });
    }

    private removeFromUpgradingSlot() {
        this.upgradingSpirit = undefined;
        this.upgradingSpiritContainer = undefined;
        this.removeSlotSpirit(this.upgradingSlot!);

        // If there was a sacrificing spirit, remove it since it's no longer valid
        if (this.sacrificingSpirit) {
            this.removeFromSacrificingSlot();
        }

        this.checkUpgradeButtonState();

        // Hide sacrificing slot since no upgrading spirit is present
        (this.sacrificingSlot as any)?.setVisible(false);
        this.sacrificingSlotTitle?.setVisible(false);

        // Rebuild the entire panel to restore interactive state and proper ordering
        this.rebuildSpiritsPanel();
    }

    private removeFromSacrificingSlot() {
        const spiritToReturn = this.sacrificingSpirit;

        this.sacrificingSpirit = undefined;
        this.sacrificingSpiritContainer = undefined;
        this.removeSlotSpirit(this.sacrificingSlot!);
        this.checkUpgradeButtonState();

        // Return the spirit to the panel
        if (spiritToReturn) {
            this.returnSpiritToPanel(spiritToReturn);
        }
    }

    private removeSlotSpirit(slot: Phaser.GameObjects.GameObject) {
        this.ui = this.ui.filter(obj => {
            if (obj instanceof AbilityWidget || obj instanceof SpiritWidget || obj instanceof Phaser.GameObjects.Image) {
                const distance = Math.abs(obj.x - (slot as any).x) + Math.abs(obj.y - (slot as any).y);
                if (distance < SLOT_PROXIMITY_THRESHOLD) {
                    obj.destroy();
                    return false;
                }
            }
            return true;
        });
    }


    private sortedAbilitiesWithStartingLast(state: Game2DerivedState): Ability[] {
        const abilities = sortedAbilities(state);
        const usableAbilities: Ability[] = [];
        const fullyUpgradedAbilities: Ability[] = [];
        const startingAbilities: Ability[] = [];

        for (const ability of abilities) {
            if (isStartingAbility(ability)) {
                startingAbilities.push(ability);
            } else if (getAbilityUpgradeLevel(ability) >= MAX_UPGRADE_LEVEL) {
                fullyUpgradedAbilities.push(ability);
            } else {
                usableAbilities.push(ability);
            }
        }

        return [...usableAbilities, ...fullyUpgradedAbilities, ...startingAbilities];
    }

    private checkUpgradeButtonState() {
        const bothSpiritsSelected = this.upgradingSpirit !== undefined && this.sacrificingSpirit !== undefined;

        if (bothSpiritsSelected && this.upgradingSpirit && this.sacrificingSpirit) {
            const cost = abilityValue(this.upgradingSpirit);
            const currentGold = this.state.player?.gold ?? BigInt(0);
            const hasEnoughGold = currentGold >= cost;

            this.upgradeCostLabel?.setVisible(true);
            this.upgradeCostAmount?.setText(`${cost}`);
            this.upgradeCostAmount?.setVisible(true);

            // Change cost color based on affordability
            if (hasEnoughGold) {
                this.upgradeCostAmount?.setColor(Color.Yellow);
            } else {
                this.upgradeCostAmount?.setColor(Color.Red);
            }

            // Enable button only if player has enough gold
            this.upgradeButton?.setEnabled(hasEnoughGold);

            // Add/remove tooltip based on gold availability
            if (!hasEnoughGold && this.upgradeButton) {
                // Destroy old tooltip if it exists
                this.upgradeButtonTooltip?.destroy();
                this.upgradeButtonTooltip = addTooltip(this, this.upgradeButton, `Not enough gold! Need ${cost}, have ${currentGold}`, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
            } else {
                // Remove tooltip if we have enough gold
                this.upgradeButtonTooltip?.destroy();
                this.upgradeButtonTooltip = undefined;
            }
        } else {
            this.upgradeCostLabel?.setVisible(false);
            this.upgradeCostAmount?.setVisible(false);
            this.upgradeButton?.setEnabled(false);

            // Remove tooltip when spirits are removed
            this.upgradeButtonTooltip?.destroy();
            this.upgradeButtonTooltip = undefined;
        }
    }

    private async performUpgrade() {
        if (!this.upgradingSpirit || !this.sacrificingSpirit) {
            logger.ui.error('Both spirits must be selected');
            return;
        }

        const upgradeLevel = getAbilityUpgradeLevel(this.upgradingSpirit);
        if (upgradeLevel >= MAX_UPGRADE_LEVEL) {
            logger.ui.warn('Cannot upgrade - spirit is already fully upgraded');
            this.errorText?.setText('This spirit is already fully upgraded!');
            return;
        }

        // Disable button and show spinner during upgrade
        this.upgradeButton?.setEnabled(false);
        txSpinner.show("Generating Proof");
        this.input.enabled = false;

        try {
            logger.ui.info('Calling upgrade_ability contract method');
            const upgradedAbilityId = await this.api.upgrade_ability(this.upgradingSpirit, this.sacrificingSpirit);
            logger.ui.info('Upgrade circuit complete, waiting for state update');

            txSpinner.show("Waiting Transaction");

            // Store the upgraded ability ID to wait for it in onStateChange
            this.pendingUpgradedAbilityId = upgradedAbilityId;

            // Check if the ability already exists in the current state (state updated first)
            const upgradedAbility = this.state.allAbilities.get(upgradedAbilityId);
            if (upgradedAbility !== undefined) {
                // State already updated! Clear immediately
                logger.ui.info('Upgrade complete - upgraded ability already in state');
                this.pendingUpgradedAbilityId = undefined;

                txSpinner.hide();
                this.input.enabled = true;

                // Show upgrade success screen first
                this.showingSuccessScreen = true;
                this.scene.pause();

                // Remove old success screen if it exists
                const existingSuccessScreen = this.scene.get('UpgradeSuccessScreen');
                if (existingSuccessScreen) {
                    this.scene.remove('UpgradeSuccessScreen');
                }

                // Add and start fresh success screen
                this.scene.add('UpgradeSuccessScreen', new UpgradeSuccessScreen(upgradedAbility), true);

                this.sound.play('upgrade-success', { volume: 1.0 });

                // Play upgrade animations after success screen is closed
                this.scene.get('UpgradeSuccessScreen')?.events.once('shutdown', () => {
                    this.showingSuccessScreen = false;
                    this.playUpgradeAnimation();
                    this.playSacrificeAnimation();
                    // Rebuild panel to refresh grayed-out states
                    this.rebuildSpiritsPanel();
                });

                // Clear the slots
                this.upgradingSpirit = undefined;
                this.sacrificingSpirit = undefined;
                this.upgradingSpiritContainer = undefined;
                this.sacrificingSpiritContainer = undefined;

                // Hide sacrificing slot
                (this.sacrificingSlot as any)?.setVisible(false);
                this.sacrificingSlotTitle?.setVisible(false);

                // Clear slot UI
                if (this.upgradingSlot) {
                    this.removeSlotSpirit(this.upgradingSlot);
                }
                if (this.sacrificingSlot) {
                    this.removeSlotSpirit(this.sacrificingSlot);
                }

                this.checkUpgradeButtonState();
            }
            // Otherwise, onStateChange will handle cleanup when state updates
        } catch (error) {
            logger.ui.error('Upgrade failed:', error);
            this.upgradeButton?.setEnabled(true);
            this.pendingUpgradedAbilityId = undefined;
            txSpinner.hide();
            this.input.enabled = true;

            // Show network error overlay for network-related errors
            if (!this.scene.get('NetworkError')) {
                this.scene.add('NetworkError', new NetworkError());
            }
            const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
            networkErrorScene.setErrorMessage('Error upgrading spirit. Please try again.');
            this.scene.launch('NetworkError');
        }
    }

    private playSlotAnimation(
        slot: Phaser.GameObjects.GameObject,
        particleSystem: UpgradeSparkleParticleSystem | SacrificeDissolveParticleSystem,
        slotTween: { alphaTo: number, scaleTo: number, duration: number, ease: string },
        flashColor: number,
        flashDuration: number
    ) {
        const { x, y } = this.getSlotPosition(slot);

        particleSystem.setDepth(100);
        particleSystem.burst();

        this.tweens.add({
            targets: slot,
            alpha: { from: 1, to: slotTween.alphaTo },
            scale: { from: 1, to: slotTween.scaleTo },
            duration: slotTween.duration,
            yoyo: true,
            repeat: 3,
            ease: slotTween.ease,
        });

        const flash = this.add.circle(x, y, 80, flashColor, flashColor === 0xFFFFFF ? 0.8 : 0.7);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: flashColor === 0xFFFFFF ? 3 : 2.5,
            duration: flashDuration,
            ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
        });

        this.time.delayedCall(1500, () => particleSystem.destroy());
    }

    private playUpgradeAnimation() {
        if (!this.upgradingSlot) return;
        const { x, y } = this.getSlotPosition(this.upgradingSlot);
        this.playSlotAnimation(
            this.upgradingSlot,
            new UpgradeSparkleParticleSystem(this, x, y),
            { alphaTo: 0.2, scaleTo: 1.4, duration: 250, ease: 'Bounce.easeOut' },
            0xFFFFFF,
            600
        );
    }

    private playSacrificeAnimation() {
        if (!this.sacrificingSlot) return;
        const { x, y } = this.getSlotPosition(this.sacrificingSlot);
        this.playSlotAnimation(
            this.sacrificingSlot,
            new SacrificeDissolveParticleSystem(this, x, y),
            { alphaTo: 0.1, scaleTo: 0.6, duration: 350, ease: 'Sine.easeInOut' },
            0x8B00FF,
            800
        );
    }

    private getAbilityFromContainer(container: Phaser.GameObjects.Container): Ability {
        if (!container.list || container.list.length === 0) {
            throw new Error('Invalid container structure');
        }

        // Find AbilityWidget in the container's children
        for (const child of container.list) {
            if (child instanceof AbilityWidget) {
                return child.ability;
            }
        }

        throw new Error('No AbilityWidget found in container');
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
}