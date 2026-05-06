import { ParticleSystem } from './particle-system';
import { Color, colorToNumber } from '../constants/colors';

/**
 * Purple dissolve particle effect for sacrifice animations
 */
export class SacrificeDissolveParticleSystem extends ParticleSystem {
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 0, 0, 'sacrifice-dissolve-texture', false, false);
    }

    protected createTexture() {
        const graphics = this.scene.add.graphics();

        graphics.fillStyle(colorToNumber(Color.Violet));
        graphics.fillRect(4, 0, 4, 4); // top
        graphics.fillRect(0, 4, 4, 4); // left
        graphics.fillRect(4, 4, 4, 4); // center
        graphics.fillRect(8, 4, 4, 4); // right
        graphics.fillRect(4, 8, 4, 4); // bottom

        graphics.generateTexture(this.texture, 12, 12);
        graphics.destroy();
    }

    protected getParticleConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
        return {
            speed: { min: 100, max: 250 },
            angle: { min: 0, max: 360 },
            scale: { start: 1.5, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 1400,
            gravityY: 150,
            quantity: 5,
            frequency: 25,
            tint: [0x8B00FF, 0x4B0082, 0x800080, 0xFF00FF], // Purple, indigo, violet, magenta
            maxParticles: 70,
            rotate: { min: 0, max: 360 },
        };
    }

    public burst() {
        this.particleManager.explode(70);
    }
}
