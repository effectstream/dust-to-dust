import { fontStyle, GAME_WIDTH, GAME_HEIGHT, } from "../main";
import {Color, colorToNumber} from "../constants/colors";

const defaultLoaderText = `Loading`;
const fontSize = 14;

export class Loader extends Phaser.Scene {
    private text: string;  // Update this using the setText() method
    private textObject?: Phaser.GameObjects.Text
    animateDots: boolean;

    constructor(text?: string, animateDots?: boolean) {
        super('Loader');

        this.text = text ?? defaultLoaderText;
        this.animateDots = animateDots !== undefined ? animateDots : true;
    }

    create() {
        this.scene.bringToTop();  // Ensure this scene is rendered on top of others

        this.add.rectangle(GAME_WIDTH/2, GAME_HEIGHT/2, GAME_WIDTH, GAME_HEIGHT, colorToNumber(Color.DeepPlum), 0.90)
        this.textObject = this.add.text(
            GAME_WIDTH/2, GAME_HEIGHT/2,
            this.text,
            fontStyle(fontSize)
        )
        .setOrigin(0.5, 0.65)
        .setStroke(Color.Licorice, 10); // Black border, 10px width
    }

    update() {
        if (this.textObject !== undefined && this.animateDots) {
            // Animate dots in the loader text
            const time = this.game.getTime();
            const cycle = Math.floor(time / 300) % 4;
            this.textObject.setText(this.text + '.'.repeat(cycle));
        }
    }

    setText(text: string) {
        this.text = text;
        if (this.scene.isActive() && this.textObject !== undefined) {
            this.textObject.setText(text);
        }
    }

}