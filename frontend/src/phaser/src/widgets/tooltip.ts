/**
 * Generic tooltip widget that can be applied to any game object
 * Provides hover-based tooltip functionality with fade-in animation and cursor tracking
 */
import { fontStyle, GAME_HEIGHT, GAME_WIDTH } from "../main";

export class Tooltip {
    private scene: Phaser.Scene;
    private target: Phaser.GameObjects.GameObject;
    private helpText: Phaser.GameObjects.Text;
    private helpTween: Phaser.Tweens.Tween | null;
    private delay: number;
    private duration: number;

    /**
     * Creates a tooltip for any game object
     * @param scene The Phaser scene
     * @param target The game object to add tooltip to (must be Interactive)
     * @param tooltipText The text to display in the tooltip
     * @param delay Delay before tooltip appears (default: 800ms)
     * @param duration Duration of fade-in animation (default: 800ms)
     */
    constructor(
        scene: Phaser.Scene,
        target: Phaser.GameObjects.GameObject,
        tooltipText: string,
        delay: number = 800,
        duration: number = 800
    ) {
        this.scene = scene;
        this.target = target;
        this.delay = delay;
        this.duration = duration;
        this.helpTween = null;

        // Create the tooltip text object
        this.helpText = scene.add.text(0, 0, tooltipText, fontStyle(10, {
                wordWrap: { width: GAME_WIDTH * 0.6 },
            }))
            .setAlpha(0)
            .setVisible(false)
            .setOrigin(0.5, 0.5)
            .setDepth(1000); // High depth to ensure it appears above other elements

        // Ensure target is interactive
        if (!target.input) {
            (target as any).setInteractive();
        }

        // Add event listeners
        target.on('pointerover', this.onPointerOver, this);
        target.on('pointerout', this.onPointerOut, this);

        // Hide tooltip when scene pauses, sleeps, or shuts down
        scene.events.on('pause', this.onPointerOut, this);
        scene.events.on('sleep', this.onPointerOut, this);
        scene.events.on('shutdown', this.onPointerOut, this);

        // Add to scene's update loop for cursor tracking
        scene.events.on('preupdate', this.preUpdate, this);
    }

    private onPointerOver = () => {
        if (!this.helpText.visible) {
            this.helpText.setVisible(true);
            this.helpTween = this.scene.tweens.add({
                targets: this.helpText,
                alpha: 1,
                delay: this.delay,
                duration: this.duration,
            });
        }
    };

    private onPointerOut = () => {
        this.helpText.setVisible(false);
        this.helpText.setAlpha(0);
        this.helpTween?.destroy();
        this.helpTween = null;
    };

    private preUpdate = () => {
        if (this.helpText.visible) {
            // Hide tooltip if scene input was disabled (e.g. spinner overlay)
            if (!this.scene.input.enabled) {
                this.onPointerOut();
                return;
            }

            const mx = this.scene.input.activePointer.worldX;
            const my = this.scene.input.activePointer.worldY;

            // Simple positioning: place tooltip near mouse cursor with screen bounds checking
            let finalX = mx + 16; // Offset to the right of cursor
            let finalY = my - this.helpText.height / 2 - 16; // Offset above cursor, accounting for text height

            // Keep tooltip within screen bounds
            if (finalX + this.helpText.width / 2 > GAME_WIDTH) {
                finalX = GAME_WIDTH - this.helpText.width / 2 - 16;
            }
            if (finalX - this.helpText.width / 2 < 0) {
                finalX = this.helpText.width / 2 + 16;
            }
            if (finalY - this.helpText.height / 2 < 0) {
                finalY = my + 32; // Show below cursor if no room above
            }
            if (finalY + this.helpText.height / 2 > GAME_HEIGHT) {
                finalY = GAME_HEIGHT - this.helpText.height / 2 - 16;
            }

            this.helpText.setPosition(finalX, finalY);
        }
    };

    /**
     * Update the tooltip text
     */
    public setText(text: string): void {
        this.helpText.setText(text);
    }

    /**
     * Show the tooltip immediately (without delay)
     */
    public show(): void {
        this.helpText.setVisible(true);
        this.helpText.setAlpha(1);
        this.helpTween?.destroy();
        this.helpTween = null;
    }

    /**
     * Hide the tooltip immediately
     */
    public hide(): void {
        this.onPointerOut();
    }

    /**
     * Enable or disable the tooltip
     */
    public setEnabled(enabled: boolean): void {
        if (enabled) {
            this.target.on('pointerover', this.onPointerOver, this);
            this.target.on('pointerout', this.onPointerOut, this);
        } else {
            this.target.off('pointerover', this.onPointerOver, this);
            this.target.off('pointerout', this.onPointerOut, this);
            this.hide();
        }
    }

    /**
     * Clean up the tooltip and remove event listeners
     */
    public destroy(): void {
        this.target.off('pointerover', this.onPointerOver, this);
        this.target.off('pointerout', this.onPointerOut, this);
        this.scene.events.off('preupdate', this.preUpdate, this);
        this.scene.events.off('pause', this.onPointerOut, this);
        this.scene.events.off('sleep', this.onPointerOut, this);
        this.scene.events.off('shutdown', this.onPointerOut, this);
        this.helpTween?.destroy();
        this.helpText.destroy();
    }
}

/**
 * Convenience function to quickly add a tooltip to any game object
 * @param scene The Phaser scene
 * @param target The game object to add tooltip to
 * @param tooltipText The text to display
 * @param delay Optional delay before showing (default: 800ms)
 * @param duration Optional fade-in duration (default: 800ms)
 * @returns The created Tooltip instance
 */
export function addTooltip(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.GameObject,
    tooltipText: string,
    delay: number = 800,
    duration: number = 800
): Tooltip {
    return new Tooltip(scene, target, tooltipText, delay, duration);
}