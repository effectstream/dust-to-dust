import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { Subscription } from "rxjs";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger } from "../../main";
import { Button } from "../../widgets/button";
import { Color } from "../../constants/colors";
import { MainMenu } from "../main";
import { addScaledImage } from "../../utils/scaleImage";
import { TopBar } from "../../widgets/top-bar";
import { SellSpiritsMenu } from "./sell";
import { UpgradeSpiritsMenu } from "./upgrade";

// Constants
const TITLE_Y_RATIO = 0.15;
const TITLE_FONT_SIZE = 24;
const TITLE_STROKE_THICKNESS = 8;

const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 80;
const BUTTON_SPACING = 100;
const BUTTON_FONT_SIZE = 16;

export class ShopMenu extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription;
    state: Game2DerivedState;
    topBar: TopBar | undefined;

    constructor(api: DeployedGame2API, state: Game2DerivedState) {
        super("ShopMenu");

        this.api = api;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
        this.state = state;
    }

    create() {
        this.topBar = new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Return to Hub');

        this.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT * TITLE_Y_RATIO,
            'Spirit Shop',
            fontStyle(TITLE_FONT_SIZE, {
                color: Color.White,
                stroke: Color.Licorice,
                strokeThickness: TITLE_STROKE_THICKNESS
            })
        ).setOrigin(0.5);

        new Button(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 - BUTTON_SPACING / 2,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Upgrade',
            BUTTON_FONT_SIZE,
            () => {
                logger.ui.info('Navigating to Upgrade Spirits');
                this.scene.remove('UpgradeSpiritsMenu');
                this.scene.add('UpgradeSpiritsMenu', new UpgradeSpiritsMenu(this.api, this.state));
                this.scene.start('UpgradeSpiritsMenu');
            },
            'Combine spirits to create stronger versions'
        );

        new Button(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 + BUTTON_SPACING / 2,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Sell',
            BUTTON_FONT_SIZE,
            () => {
                logger.ui.info('Navigating to Sell Spirits');
                this.scene.remove('SellSpiritsMenu');
                this.scene.add('SellSpiritsMenu', new SellSpiritsMenu(this.api, this.state));
                this.scene.start('SellSpiritsMenu');
            },
            'Trade spirits for gold'
        );

        this.onStateChange(this.state);
    }

    shutdown() {
        this.subscription?.unsubscribe();
    }

    private onStateChange(state: Game2DerivedState) {
        this.state = structuredClone(state);
    }
}