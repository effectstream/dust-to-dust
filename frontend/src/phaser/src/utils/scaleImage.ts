import Phaser from 'phaser';

export const BASE_SPRITE_SCALE = 2.0;

export const addScaledImage = (scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image => {
    const image = scene.add.image(x, y, key);
    image.setScale(BASE_SPRITE_SCALE);
    return image;
}

/// generic function to scale anything 
export function scale<T extends Phaser.GameObjects.Components.Transform>(object: T): T {
    return object.setScale(BASE_SPRITE_SCALE);
}
