import { Color, colorToNumber } from "../constants/colors";

/**
 * Creates a subtle glow effect with pulsing animation.
 * Can be positioned anywhere and provides a magical ambient glow.
 */
export class GlowEffect {
    private scene: Phaser.Scene;
    private graphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, centerX: number, centerY: number, radiusX: number = 100, radiusY: number = 80) {
        this.scene = scene;
        this.graphics = this.scene.add.graphics();
        this.createGlow(centerX, centerY, radiusX, radiusY);
    }

    private createGlow(centerX: number, centerY: number, baseRadiusX: number, baseRadiusY: number, glowColor: Color = Color.Yellow) {
        // Create multiple concentric ellipses for a smooth glow effect, centered at 0,0
        // Scale the glow layers based on the provided radii
        const glowScales = [1.5, 1.25, 1.0, 0.75, 0.5]; // Largest to smallest
        const glowAlphas = [0.05, 0.08, 0.12, 0.18, 0.25]; // Weakest to strongest

        for (let i = 0; i < glowScales.length; i++) {
            this.graphics.fillStyle(colorToNumber(glowColor), glowAlphas[i]);
            // Draw centered at 0,0 so scaling works from center
            const layerRadiusX = baseRadiusX * glowScales[i];
            const layerRadiusY = baseRadiusY * glowScales[i];
            this.graphics.fillEllipse(0, 0, layerRadiusX * 2, layerRadiusY * 2);
        }
        
        // Position the graphics at the specified center
        this.graphics.setPosition(centerX, centerY);

        // Set depth between background and UI elements
        this.graphics.setDepth(-8);

        // Add subtle pulsing animation (alpha and scale)
        this.scene.tweens.add({
            targets: this.graphics,
            alpha: 0.7,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    /**
     * Set the visibility of the glow
     */
    public setVisible(visible: boolean): void {
        this.graphics.setVisible(visible);
    }

    /**
     * Set the depth/z-index of the glow
     */
    public setDepth(depth: number): void {
        this.graphics.setDepth(depth);
    }

    /**
     * Move the glow to a new position
     */
    public setPosition(x: number, y: number): void {
        this.graphics.setPosition(x, y);
    }

    /**
     * Clean up the glow and remove it from the scene
     */
    public destroy(): void {
        this.scene.tweens.killTweensOf(this.graphics);
        this.graphics.destroy();
    }
}