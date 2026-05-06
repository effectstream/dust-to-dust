import { DeployedGame2API, Game2DerivedState, safeJSONString } from "game2-api";
import { pureCircuits } from "game2-contract";
import { Subscription } from "rxjs";
import { AbilityWidget, SpiritWidget } from "../../widgets/ability";
import { createSpiritAnimations } from "../../animations/spirit";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../../main";
import { Button } from "../../widgets/button";
import { NetworkError } from "../network-error";
import { txSpinner } from "../../tx-spinner";
import { Color } from "../../constants/colors";
import { isStartingAbility, sortedAbilities } from "../pre-battle";
import { addScaledImage } from "../../utils/scaleImage";
import { ScrollablePanel } from "../../widgets/scrollable";
import { TopBar } from "../../widgets/top-bar";
import { addTooltip } from "../../widgets/tooltip";
import { ShopMenu } from "./shop";
import { abilityValue } from "../../battle/logic";

// Constants
const UNSELLABLE_TOOLTIP_TEXT = "Starting spirits cannot be sold";

// Layout constants
const TITLE_Y_RATIO = 0.1;
const TITLE_FONT_SIZE = 24;
const TITLE_STROKE_THICKNESS = 8;

const PANEL_WIDTH_RATIO = 0.95;
const PANEL_HEIGHT = 350;
const PANEL_Y_RATIO = 0.6;

const ABILITY_BUTTON_WIDTH = 100;
const BUTTON_FONT_SIZE = 8;
const ABILITY_WIDGET_Y = 80;
const ABILITY_CONTAINER_HEIGHT = 128;
const SELL_BUTTON_Y = -39;
const SELL_BUTTON_HEIGHT = 64;
const SPIRIT_WIDGET_Y = -120;

const TOOLTIP_WIDTH = 300;
const TOOLTIP_HEIGHT = 400;

export class SellSpiritsMenu extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription;
    state: Game2DerivedState;
    ui: Phaser.GameObjects.GameObject[];
    topBar: TopBar | undefined;
    waitingForSell: boolean = false;

    constructor(api: DeployedGame2API, state: Game2DerivedState) {
        super("SellSpiritsMenu");
        
        this.api = api;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
        this.state = state;
        this.ui = [];
    }

    create() {

        this.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT * TITLE_Y_RATIO,
            'Sell Spirits',
            fontStyle(TITLE_FONT_SIZE, {
                color: Color.White,
                stroke: Color.Licorice,
                strokeThickness: TITLE_STROKE_THICKNESS
            })
        ).setOrigin(0.5);

        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg-shop').setDepth(-10);
        createSpiritAnimations(this);

        this.topBar = new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('ShopMenu');
                this.scene.add('ShopMenu', new ShopMenu(this.api, this.state));
                this.scene.start('ShopMenu');
            }, 'Back to Shop');

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

        const scrollablePanel = new ScrollablePanel(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT * PANEL_Y_RATIO,
            GAME_WIDTH * PANEL_WIDTH_RATIO,
            PANEL_HEIGHT
        );
        this.ui.push(scrollablePanel.panel);

        const abilities = sortedAbilities(state);
        for (const ability of abilities) {
            const value = Number(abilityValue(ability));
            const isStarting = isStartingAbility(ability);

            const abilityWidget = new AbilityWidget(this, 0, ABILITY_WIDGET_Y, ability);
            const abilityContainer = this.add.container(0, 0).setSize(abilityWidget.width, ABILITY_CONTAINER_HEIGHT);
            abilityContainer.add(abilityWidget);

            const sellButton = new Button(
                this,
                0,
                SELL_BUTTON_Y,
                ABILITY_BUTTON_WIDTH - 8,
                SELL_BUTTON_HEIGHT,
                `Sell\n$${value}`,
                BUTTON_FONT_SIZE,
                () => {
                    if (!isStarting) {
                        this.handleSellAbility(ability);
                    }
                }
            );

            const spiritWidget = new SpiritWidget(this, 0, SPIRIT_WIDGET_Y, ability);

            if (isStarting) {
                sellButton.setEnabled(false);
                abilityWidget.setAlpha(0.5);
                spiritWidget.setAlpha(0.5);

                addTooltip(this, abilityWidget, UNSELLABLE_TOOLTIP_TEXT, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
                addTooltip(this, sellButton, UNSELLABLE_TOOLTIP_TEXT, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
                addTooltip(this, spiritWidget, UNSELLABLE_TOOLTIP_TEXT, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
            }

            abilityContainer.add(sellButton);
            abilityContainer.add(spiritWidget);
            this.ui.push(abilityContainer);

            scrollablePanel.addChild(abilityContainer);
        }
    }

    private handleSellAbility(ability: any) {
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
}