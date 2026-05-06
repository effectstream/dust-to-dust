import { Ability } from "game2-contract";
import { fontStyle, GAME_WIDTH, GAME_HEIGHT } from "../../main";
import { Color, colorToNumber } from "../../constants/colors";
import { AbilityWidget, SpiritWidget } from "../../widgets/ability";
import { addScaledImage } from "../../utils/scaleImage";
import { Button } from "../../widgets/button";

const STAR_SPACING = 20;
const STAR_Y_OFFSET = -85;
const MAX_UPGRADE_LEVEL = 3;
const SPIRIT_OFFSET_X = 100;
const TEXT_Y_OFFSET = -200;
const BUTTON_WIDTH = 150;
const BUTTON_HEIGHT = 60;
const BUTTON_FONT_SIZE = 12;

// Helper function to get ability upgrade level
function getAbilityUpgradeLevel(ability: Ability): number {
    return Number(ability.upgrade_level);
}

export class UpgradeSuccessScreen extends Phaser.Scene {
    private ability: Ability | undefined;

    constructor(ability?: Ability) {
        super('UpgradeSuccessScreen');
        this.ability = ability;
    }

    init(data?: { ability: Ability }) {
        if (data?.ability) {
            this.ability = data.ability;
        }
    }

    create() {
        if (!this.ability) {
            return;
        }

        this.scene.bringToTop();

        // Semi-transparent background overlay
        const background = this.add.rectangle(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2,
            GAME_WIDTH,
            GAME_HEIGHT,
            colorToNumber(Color.Licorice),
            0.85
        );
        background.setInteractive();

        // "Upgrade Successful" text
        this.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 + TEXT_Y_OFFSET,
            'Upgrade Successful',
            fontStyle(14)
        )
        .setOrigin(0.5)
        .setStroke(Color.Licorice, 10);

        // Create ability and spirit widgets
        new AbilityWidget(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, this.ability);
        new SpiritWidget(this, GAME_WIDTH / 2 - SPIRIT_OFFSET_X, GAME_HEIGHT / 2, this.ability);

        // Create upgrade stars
        const upgradeLevel = getAbilityUpgradeLevel(this.ability);
        this.createUpgradeStars(GAME_WIDTH / 2, GAME_HEIGHT / 2, upgradeLevel);

        // Add "Accept" button
        new Button(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 + 110,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Accept',
            BUTTON_FONT_SIZE,
            () => {
                this.scene.resume('UpgradeSpiritsMenu');
                this.scene.stop();
            }
        );
    }

    private createUpgradeStars(x: number, y: number, upgradeLevel: number): void {
        const starStartX = -(MAX_UPGRADE_LEVEL - 1) * STAR_SPACING / 2;

        const starBackground = addScaledImage(this, x, y + STAR_Y_OFFSET, 'upgrade-star-background');

        for (let i = 0; i < MAX_UPGRADE_LEVEL; i++) {
            const starX = x + starStartX + i * STAR_SPACING;
            const starImage = i < upgradeLevel ? 'upgrade-star' : 'upgrade-star-slot';
            addScaledImage(this, starX, y + STAR_Y_OFFSET, starImage);
        }
    }
}
