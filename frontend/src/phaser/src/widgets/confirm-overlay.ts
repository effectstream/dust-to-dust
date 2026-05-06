/**
 * ConfirmOverlay - Generic confirmation dialog with OK/Cancel buttons
 */
import { fontStyle, GAME_HEIGHT, GAME_WIDTH } from "../main";
import { Button } from "./button";

export class ConfirmOverlay extends Phaser.GameObjects.Container {
    private overlay: Phaser.GameObjects.Rectangle;
    private confirmButton: Button;
    private cancelButton: Button;
    private messageText: Phaser.GameObjects.Text;

    constructor(
        scene: Phaser.Scene,
        message: string,
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

        // Message text
        this.messageText = scene.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT * 0.35,
            message,
            fontStyle(12)
        ).setOrigin(0.5, 0.5).setAlign('center');
        this.add(this.messageText);

        // OK button
        this.confirmButton = new Button(
            scene,
            GAME_WIDTH / 2 - 80,
            GAME_HEIGHT * 0.6,
            140,
            48,
            'OK',
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
