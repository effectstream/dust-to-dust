/**
 * Generic Button UI object. Taken from pvp-arena. Might be replaced with rex-ui
 */
import { fontStyle } from "../main";
import BBCodeText from 'phaser3-rex-plugins/plugins/bbcodetext.js';
import { BG_TYPE, makeWidgetBackground, WidgetBackground } from "./widget-background";
import { Tooltip } from "./tooltip";


export class Button extends Phaser.GameObjects.Container {
    bg: WidgetBackground & Phaser.GameObjects.GameObject;
    enabled: boolean = true;
    text: BBCodeText;
    tooltip: Tooltip | null;
    soundOnClick: boolean;

    constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, fontSize: number, onClick: () => void, helpText?: string, soundOnClick = true) {
        super(scene, x, y);

        this.tooltip = null;
        this.soundOnClick = soundOnClick;

        this.bg = makeWidgetBackground(scene, 0, 0, w, h, BG_TYPE.Stone);
        this.add(this.bg);

        // this.text = scene.add.text(0, 0, text, fontStyle(fontSize, { wordWrap: { width: w - 8 } })).setOrigin(0.5, 0.65)
        // the -3 is to have it be centered in the top surface of the stone tablet as there is a side texture in the bottom of the sprite
        // @ts-expect-error
        this.text = scene.add.rexBBCodeText(0, -3, text, fontStyle(fontSize, { color: this.bg.textColor, wordWrap: { width: w - 8 } }))
            .setOrigin(0.5, 0.65);

        this.add(this.text);

        this.setSize(w, h);
        this.setInteractive();
        this.on('pointerdown', () => {
            if (this.enabled) {
                if (this.soundOnClick) {
                    this.scene.sound.play('button-press-1', { volume: 0.5 });
                }   
            }
        });
        this.on('pointerup', () => {
            if (this.enabled) {
                (this.scene.game.canvas as HTMLCanvasElement).style.cursor = 'default';
                onClick();
            }
        });
        this.on('pointerover', () => {
            if (this.enabled) {
                this.bg.onMouseOver();
                (this.scene.game.canvas as HTMLCanvasElement).style.cursor = 'pointer';
                this.text.setColor(this.bg.textColorOver);
            }
        });
        this.on('pointerout', () => {
            if (this.enabled) {
                this.bg.onMouseOff();
                (this.scene.game.canvas as HTMLCanvasElement).style.cursor = 'default';
                this.text.setColor(this.bg.textColor);
            }
        });

        scene.add.existing(this);

        this.bg.tweenIn({
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                this.text.alpha = tween.progress;
                this.text.scaleX = tween.progress;
            },
            duration: 500,
            onComplete: () => {
                // Create tooltip after button animation completes
                if (helpText != null) {
                    this.tooltip = new Tooltip(scene, this, helpText);
                }
            }
        });
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        this.bg.setEnabled(enabled);
        // Keep button interactive even when disabled so tooltips work
        // The onClick handler already checks this.enabled before executing
        return this;
    }

    destroy() {
        this.tooltip?.destroy();
        super.destroy();
    }

}