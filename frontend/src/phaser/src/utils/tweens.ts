
export function tweenUpAlpha(target: Phaser.GameObjects.Container): Phaser.Types.Tweens.TweenChainBuilderConfig {
    // to stretch up we need to change y too not just scaleY
    return {
        targets: target,
        y: target.y,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 250,
        onStart: () => {
            target
                .setAlpha(0)
                .setScale(0.5, 0)
                .setY(target.y + target.height / 2);
        },
    };
}

export function tweenDownAlpha(target: Phaser.GameObjects.Container): Phaser.Types.Tweens.TweenChainBuilderConfig {
    // to shrink down we need to change y too not just scaleY
    return {
        targets: target,
        alpha: 0,
        y: target.y - target.height / 2,
        scaleX: 0.5,
        scaleY: 0,
        duration: 250,
        onStart: () => {
            target
                .setAlpha(1)
                .setScale(1, 1);
        },
    };
}