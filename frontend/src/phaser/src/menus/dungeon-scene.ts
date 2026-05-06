import { GAME_HEIGHT, GAME_WIDTH } from "../main";
import { addScaledImage } from "../utils/scaleImage";
import { GlowEffect } from "../widgets/glow-effect";
import { PollenParticleSystem } from "../particles/pollen";

/**
 * Dungeon background scene with portal glow and pollen particles.
 * Can be used as a background layer for other scenes.
 */
export class DungeonScene extends Phaser.Scene {
    constructor() {
        super({ key: 'DungeonScene', active: false });
    }

    create() {
        // Ensure this scene renders behind other scenes
        this.scene.sendToBack();
        
        // Add the hub background image
        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg-hub1').setDepth(-10);
        
        // Add subtle glow around the portal
        new GlowEffect(this, GAME_WIDTH / 1.9, GAME_HEIGHT / 2.2, 92, 115);
        
        // Initialize and start pollen particle system with 50px radius
        const pollenLocations = [
            { x: GAME_WIDTH / 8, y: GAME_HEIGHT / 2 }, // Bottom Left
            { x: GAME_WIDTH / 1.15, y: GAME_HEIGHT / 1.8 }, // Bottom Right
            { x: GAME_WIDTH / 1.25, y: GAME_HEIGHT / 10}, // Top Right          
        ];
        
        for (const loc of pollenLocations) {
            const pollenSystem = new PollenParticleSystem(this, loc.x, loc.y, 80, 80);
            pollenSystem.start();
        }
    }
}