import { DeployedGame2API, Game2DerivedState, safeJSONString } from "game2-api";
import { pureCircuits } from "game2-contract";
import { Subscription } from "rxjs";
import { AbilityWidget, describeAbility, SpiritWidget } from "../widgets/ability";
import { createSpiritAnimations } from "../animations/spirit";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../main";
import { Button } from "../widgets/button";
import { NetworkError } from "./network-error";
import { txSpinner } from "../tx-spinner";
import { Color } from "../constants/colors";
import { isStartingAbility, sortedAbilities } from "./pre-battle";
import { MainMenu } from "./main";
import { addScaledImage } from "../utils/scaleImage";
import { ScrollablePanel } from "../widgets/scrollable";
import { TopBar } from "../widgets/top-bar";
import { addTooltip } from "../widgets/tooltip";
import { abilityValue } from "../battle/logic";

const UNSELLABLE_TOOLTIP_TEXT = "Starting spirits cannot be sold";

export class ShopMenu extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription;
    state: Game2DerivedState;
    ui: Phaser.GameObjects.GameObject[];
    topBar: TopBar | undefined;
    waitingForSell: boolean = false;

    constructor(api: DeployedGame2API, state: Game2DerivedState) {
        super("ShopMenu");
        
        this.api = api;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
        this.state = state;
        this.ui = [];
    }

    create() {
        // this is just here to show some contrast since we won't have a black background. TOOD: replace with a specific background
        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg-grass').setDepth(-10);
        createSpiritAnimations(this);

        this.topBar = new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Return to Hub');

        this.onStateChange(this.state);
    }

    shutdown() {
        this.subscription?.unsubscribe();
    }

    private onStateChange(state: Game2DerivedState) {
        logger.gameState.debug(`ShopMenu.onStateChange(): ${safeJSONString(state)}`);

        this.state = structuredClone(state);
        if (this.waitingForSell) {
            this.waitingForSell = false;
            txSpinner.hide();
            this.input.enabled = true;
        }

        this.ui.forEach((o) => o.destroy());
        this.ui = [];

        const scrollablePanel = new ScrollablePanel(this, GAME_WIDTH/2.0, GAME_HEIGHT * 0.6, GAME_WIDTH*0.95, 350);
        this.ui.push(scrollablePanel.panel);

        const abilityButtonWidth = 100;
        const abilities = sortedAbilities(state); // Show all abilities, not just sellable ones
        for (let i = 0; i < abilities.length; ++i) {
            const ability = abilities[i];
            const value = Number(abilityValue(ability));
            const isStarting = isStartingAbility(ability);

            const abilityWidget = new AbilityWidget(this, 0, 80, ability);
            const abilityContainer = this.add.container(0, 0).setSize(abilityWidget.width, 128);
            abilityContainer.add(abilityWidget);

            // Create sell button - disabled and greyed out for starting abilities
            const sellButton = new Button(this, 0, -39, abilityButtonWidth - 8, 64, `Sell\n$${value}`, 8, () => {
                if (!isStarting) {
                    txSpinner.show("Generating Proof");
                    this.input.enabled = false;
                    this.waitingForSell = true;
                    this.api.sell_ability(ability).then(() => {
                        txSpinner.show("Waiting Transaction");
                    }).catch((e) => {
                        this.waitingForSell = false;
                        logger.network.error(`Error selling ability: ${e}`);
                        txSpinner.hide();
                        this.input.enabled = true;

                        // Show network error overlay
                        if (!this.scene.get('NetworkError')) {
                            this.scene.add('NetworkError', new NetworkError());
                        }
                        const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
                        networkErrorScene.setErrorMessage('Error selling ability. Please try again.');
                        this.scene.launch('NetworkError');
                    });
                }
            });

            const spiritWidget = new SpiritWidget(this, 0, -120, ability);
            if (isStarting) {
                // Grey out starting abilities and add tooltips
                sellButton.setEnabled(false);
                abilityWidget.setAlpha(0.5);
                spiritWidget.setAlpha(0.5);

                // Add tooltips to all interactive elements
                addTooltip(this, abilityWidget, UNSELLABLE_TOOLTIP_TEXT, 300, 400);
                addTooltip(this, sellButton, UNSELLABLE_TOOLTIP_TEXT, 300, 400);
                addTooltip(this, spiritWidget, UNSELLABLE_TOOLTIP_TEXT, 300, 400);
            } else {
                // Add ability description tooltips for sellable abilities
                const description = describeAbility(ability);
                addTooltip(this, abilityWidget, description, 300, 400);
                addTooltip(this, spiritWidget, description, 300, 400);
            }
            abilityContainer.add(sellButton);
            abilityContainer.add(spiritWidget);
            this.ui.push(abilityContainer);

            // Add new child to scrollable panel
            scrollablePanel.addChild(abilityContainer);
        }
    }
}