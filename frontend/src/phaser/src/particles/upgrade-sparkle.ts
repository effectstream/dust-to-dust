import { ParticleSystem } from './particle-system';
import { Color, colorToNumber } from '../constants/colors';

/**
 * Golden sparkle particle effect for upgrade animations
 */
export class UpgradeSparkleParticleSystem extends ParticleSystem {
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 0, 0, 'upgrade-sparkle-texture', false, false);
    }

    protected createTexture() {
        const graphics = this.scene.add.graphics();

        // Create a small cross/star shape for sparkles
        graphics.fillStyle(colorToNumber(Color.Yellow));
        graphics.fillRect(3, 0, 2, 8); // vertical bar
        graphics.fillRect(0, 3, 8, 2); // horizontal bar

        graphics.generateTexture(this.texture, 8, 8);
        graphics.destroy();
    }

    protected getParticleConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
        return {
            speed: { min: 150, max: 400 },
            angle: { min: 0, max: 360 },
            scale: { start: 2, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 1200,
            gravityY: -200,
            quantity: 5,
            frequency: 30,
            tint: [0xFFD700, 0xFFA500, 0xFFFF00, 0xFFFFFF], // Gold, orange, yellow, white
            maxParticles: 80,
            rotate: { min: 0, max: 360 },
        };
    }

    public burst() {
        this.particleManager.explode(80);
    }
}
