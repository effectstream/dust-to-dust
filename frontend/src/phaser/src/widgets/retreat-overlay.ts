/**
 * RetreatOverlay - Confirmation overlay for retreating from battle
 */
import { fontStyle, GAME_HEIGHT, GAME_WIDTH } from "../main";
import { Button } from "./button";

export class RetreatOverlay extends Phaser.GameObjects.Container {
    private overlay: Phaser.GameObjects.Rectangle;
    private confirmButton: Button;
    private cancelButton: Button;
    private titleText: Phaser.GameObjects.Text;

    constructor(
        scene: Phaser.Scene,
        onConfirm: () => void,
        onCancel: () => void
    ) {
        super(scene, 0, 0);

        // Create semi-transparent overlay background
        this.overlay = scene.add.rectangle(
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2,
            GAME_WIDTH,
            GAME_HEIGHT,
            0x000000,
            0.7
        );
        this.overlay.setInteractive(); // Block clicks to elements behind
        this.add(this.overlay);

        // Title text
        this.titleText = scene.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT * 0.35,
            'Retreat from Battle?',
            fontStyle(18)
        ).setOrigin(0.5, 0.5);
        this.add(this.titleText);

        // Confirm button
        this.confirmButton = new Button(
            scene,
            GAME_WIDTH / 2 - 80,
            GAME_HEIGHT * 0.6,
            140,
            48,
            'Retreat',
            12,
            () => {
                this.destroy();
                onConfirm();
            }
        );
        this.add(this.confirmButton);

        // Cancel button
        this.cancelButton = new Button(
            scene,
            GAME_WIDTH / 2 + 80,
            GAME_HEIGHT * 0.6,
            140,
            48,
            'Cancel',
            12,
            () => {
                this.destroy();
                onCancel();
            }
        );
        this.add(this.cancelButton);

        scene.add.existing(this);

        // Set depth high to appear above everything
        this.setDepth(1000);

        // Fade in animation
        this.setAlpha(0);
        scene.tweens.add({
            targets: this,
            alpha: 1,
            duration: 200,
            ease: 'Power2'
        });
    }

    destroy() {
        // Fade out animation before destroying
        this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: 200,
            ease: 'Power2',
            onComplete: () => {
                super.destroy();
            }
        });
    }
}
