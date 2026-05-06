/**
 * Base class for creating particle systems.
 * 
 * To create a new particle type:
 * 1. Extend this class: `class MyParticleSystem extends ParticleSystem`
 * 2. Implement createTexture(): Create your particle's visual appearance using Phaser graphics
 * 3. Implement getParticleConfig(): Return a Phaser ParticleEmitterConfig with movement, lifespan, etc.
 * 4. Optionally pass true for spawnImmediately to spawn half the max particles instantly instead of gradual buildup
 * 
 */
export abstract class ParticleSystem {
    protected scene: Phaser.Scene;
    protected particleManager!: Phaser.GameObjects.Particles.ParticleEmitter;
    protected texture: string;
    protected originalConfig!: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, textureName: string, enableWind?: boolean, spawnImmediately?: boolean) {
        this.scene = scene;
        this.texture = textureName;
        this.createTexture();
        this.createParticleSystem(x, y, width, height, enableWind ?? true, spawnImmediately ?? false);
    }

    /**
     * Override this method to create your particle's visual appearance.
     * Use Phaser graphics to draw the particle and call graphics.generateTexture().
     */
    protected abstract createTexture(): void;

    protected createParticleSystem(x: number, y: number, width: number, height: number, enableWind?: boolean, spawnImmediately?: boolean) {
        const particleConfig = this.getParticleConfig(width, height);
        // Add emission area to the config
        this.originalConfig = {
            x: { min: -width/2, max: width/2 },
            y: { min: -height/2, max: height/2 },
            ...particleConfig
        };
        this.particleManager = this.scene.add.particles(x, y, this.texture, this.originalConfig);
        this.particleManager.setDepth(-5);
        if (enableWind) {
            this.setupWindEffect();
        }
        if (spawnImmediately) {
            // Calculate max particles based on lifespan and frequency
            const lifespan = typeof this.originalConfig.lifespan === 'number' 
                ? this.originalConfig.lifespan 
                : typeof this.originalConfig.lifespan === 'object' && 'max' in this.originalConfig.lifespan
                    ? this.originalConfig.lifespan.max
                    : 5000;
            const frequency = this.originalConfig.frequency || 100;
            const maxParticles = Math.ceil(lifespan / frequency);
            const quarterParticles = Math.ceil(maxParticles / 4);
            this.particleManager.explode(quarterParticles);
        }
    }

    /**
     * Override this method to define your particle's behavior.
     * Return a Phaser ParticleEmitterConfig with properties like:
     * - speedX, speedY: Movement speed
     * - lifespan: How long particles live
     * - alpha, scale: Visual effects
     * Note: x, y emission area is automatically handled by the parent class
     */
    protected abstract getParticleConfig(width: number, height: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

    protected setupWindEffect() {
        this.scene.time.addEvent({
            delay: 3000,
            callback: () => {
                const windStrength = Phaser.Math.Between(-10, 10);
                // Merge wind changes with original config to preserve all other settings
                const updatedConfig = {
                    ...this.originalConfig,
                    speedX: { min: windStrength - 5, max: windStrength + 5 }
                };
                this.particleManager.setConfig(updatedConfig);
            },
            loop: true
        });
    }

    public start() {
        this.particleManager.start();
    }

    public stop() {
        this.particleManager.stop();
    }

    public destroy() {
        this.particleManager.destroy();
    }

    public setPosition(x: number, y: number) {
        this.particleManager.setPosition(x, y);
    }

    public setVisible(visible: boolean) {
        this.particleManager.setVisible(visible);
    }

    public setDepth(depth: number) {
        this.particleManager.setDepth(depth);
    }
}