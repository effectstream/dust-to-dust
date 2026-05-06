/**
 * Network error overlay scene.
 * Displays a modal overlay with error message and an "Okay" button.
 * Blocks interaction with other components until dismissed.
 */
import { fontStyle, GAME_WIDTH, GAME_HEIGHT } from "../main";
import { Color, colorToNumber } from "../constants/colors";
import { Button } from "../widgets/button";

export class NetworkError extends Phaser.Scene {
    private errorMessage: string;
    private okayButton?: Button;
    private errorText?: Phaser.GameObjects.Text;

    constructor(errorMessage?: string) {
        super('NetworkError');
        this.errorMessage = errorMessage ?? 'Network Error. Please try again.';
    }

    create() {
        this.scene.bringToTop();  // Ensure this scene is rendered on top of others

        // Semi-transparent overlay to block interactions
        this.add.rectangle(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2,
            GAME_WIDTH,
            GAME_HEIGHT,
            colorToNumber(Color.Licorice),
            0.75
        );

        // Stone background box for the error message
        const boxWidth = Math.min(GAME_WIDTH * 0.8, 500);
        const boxHeight = 250;

        const errorBox = this.add.nineslice(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2,
            'tablet0',
            undefined,
            boxWidth,
            boxHeight,
            15, 15, 15, 15
        ).setOrigin(0.5);

        // Error message text
        this.errorText = this.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 - 50,
            this.errorMessage,
            fontStyle(14, {
                color: Color.Red,
                wordWrap: { width: boxWidth - 40 },
                align: 'center'
            })
        )
        .setOrigin(0.5)
        .setStroke(Color.Licorice, 8);

        // "Okay" button
        this.okayButton = new Button(
            this,
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 + 75,
            120,
            60,
            'Okay',
            14,
            () => this.dismiss()
        );
    }

    /**
     * Set the error message to display
     */
    setErrorMessage(message: string) {
        this.errorMessage = message;
        // Update the text object if it exists
        if (this.errorText) {
            this.errorText.setText(message);
        }
    }

    /**
     * Dismiss the error overlay
     */
    private dismiss() {
        this.okayButton?.destroy();
        this.scene.stop('NetworkError');
    }
}
