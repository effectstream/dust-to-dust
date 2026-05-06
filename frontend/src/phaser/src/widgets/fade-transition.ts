/**
 * Fade transition widget that creates a circular glow effect for scene transitions.
 * Starts with a small yellow glow in the center, grows to encompass the whole screen,
 * then shrinks back down.
 * NOTE: THIS IS CURRENTLY NOT USED, but kept for potential future use.
 */
import { Color, colorToNumber } from "../constants/colors";

export class FadeTransition {
    private scene: Phaser.Scene;
    private graphics: Phaser.GameObjects.Graphics;
    private isActive: boolean = false;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.graphics = this.scene.add.graphics();
        this.graphics.setDepth(1000); // High depth to appear above everything
        this.graphics.setVisible(false);
    }

    /**
     * Play the fade transition animation
     * @param onPeak - Callback function to execute when screen is fully covered (peak of animation)
     * @param onComplete - Callback function to execute when transition is complete
     * @param duration - Duration of each phase (grow/shrink) in milliseconds
     */
    public play(onPeak?: () => void, onComplete?: () => void, duration: number = 800): void {
        if (this.isActive) {
            return; // Don't start if already playing
        }

        this.isActive = true;
        this.graphics.setVisible(true);

        // Calculate screen diagonal to ensure full coverage
        const screenWidth = this.scene.scale.width;
        const screenHeight = this.scene.scale.height;
        const maxRadius = Math.sqrt(screenWidth * screenWidth + screenHeight * screenHeight) / 2;

        // Create target objects for tweening
        const growTarget = { radius: 0, alpha: 0.8 };
        const shrinkTarget = { radius: maxRadius, alpha: 1 };

        // Phase 1: Grow from center to full screen
        this.scene.tweens.add({
            targets: growTarget,
            radius: maxRadius,
            alpha: 1,
            duration: duration,
            ease: 'Quad.easeOut',
            onUpdate: () => {
                this.drawGlow(growTarget.radius, growTarget.alpha);
            },
            onComplete: () => {
                // Call onPeak callback when screen is fully covered
                if (onPeak) {
                    onPeak();
                }
                
                // Phase 2: Shrink back down
                this.scene.tweens.add({
                    targets: shrinkTarget,
                    radius: 0,
                    alpha: 0,
                    duration: duration,
                    ease: 'Quad.easeIn',
                    onUpdate: () => {
                        this.drawGlow(shrinkTarget.radius, shrinkTarget.alpha);
                    },
                    onComplete: () => {
                        this.graphics.setVisible(false);
                        this.graphics.clear();
                        this.isActive = false;
                        if (onComplete) {
                            onComplete();
                        }
                    }
                });
            }
        });
    }

    /**
     * Draw the circular glow at the specified radius and alpha
     */
    private drawGlow(radius: number, alpha: number): void {
        this.graphics.clear();
        
        const centerX = this.scene.scale.width / 2;
        const centerY = this.scene.scale.height / 2;
        const glowColor = colorToNumber(Color.Yellow);

        // Create multiple concentric circles for smooth glow effect
        const layers = 8;
        for (let i = 0; i < layers; i++) {
            const layerRadius = radius * (1 - i / layers);
            const layerAlpha = alpha * (0.3 + (i / layers) * 0.7);
            
            this.graphics.fillStyle(glowColor, layerAlpha);
            this.graphics.fillCircle(centerX, centerY, layerRadius);
        }
    }

    /**
     * Stop the transition immediately and clean up
     */
    public stop(): void {
        this.scene.tweens.killTweensOf(this);
        this.graphics.setVisible(false);
        this.graphics.clear();
        this.isActive = false;
    }

    /**
     * Clean up resources
     */
    public destroy(): void {
        this.stop();
        this.graphics.destroy();
    }

    /**
     * Continue the shrink phase of the animation from another scene
     * @param onComplete - Callback when animation finishes
     * @param duration - Duration of shrink phase
     */
    public continueFromPeak(onComplete?: () => void, duration: number = 800): void {
        if (this.isActive) {
            return; // Don't start if already playing
        }

        this.isActive = true;
        this.graphics.setVisible(true);

        // Calculate screen diagonal
        const screenWidth = this.scene.scale.width;
        const screenHeight = this.scene.scale.height;
        const maxRadius = Math.sqrt(screenWidth * screenWidth + screenHeight * screenHeight) / 2;

        // Start from peak (full coverage) and shrink down
        const shrinkTarget = { radius: maxRadius, alpha: 1 };
        
        // Draw initial peak state
        this.drawGlow(maxRadius, 1);

        // Phase 2: Shrink back down
        this.scene.tweens.add({
            targets: shrinkTarget,
            radius: 0,
            alpha: 0,
            duration: duration,
            ease: 'Quad.easeIn',
            onUpdate: () => {
                this.drawGlow(shrinkTarget.radius, shrinkTarget.alpha);
            },
            onComplete: () => {
                this.graphics.setVisible(false);
                this.graphics.clear();
                this.isActive = false;
                if (onComplete) {
                    onComplete();
                }
            }
        });
    }

    /**
     * Check if transition is currently playing
     */
    public get active(): boolean {
        return this.isActive;
    }
}