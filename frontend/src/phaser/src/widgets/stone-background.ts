import { Color, colorToNumber } from "../constants/colors";
import { BASE_SPRITE_SCALE } from "../utils/scaleImage";
import { WidgetBackground } from "./widget-background";

export class StoneBackground  extends Phaser.GameObjects.Container implements WidgetBackground {
    bg: Phaser.GameObjects.NineSlice;

    constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
        super(scene, x, y);

        this.bg = scene.add.nineslice(0, 0, `tablet${Phaser.Math.Between(0, 2)}`, undefined, w / BASE_SPRITE_SCALE, h / BASE_SPRITE_SCALE, 15, 15, 15, 15)
            .setScale(BASE_SPRITE_SCALE)
        this.add(this.bg);
        this.setSize(w, h);
    }

    public tweenIn(extraProps?: any) {
        if (extraProps != undefined && Object.hasOwn(extraProps, 'onComplete')) {
            extraProps.onComplete();
        }
    }
    public tweenOut(extraProps?: any) {
        if (extraProps != undefined && Object.hasOwn(extraProps, 'onComplete')) {
            extraProps.onComplete();
        }
    }
    public onMouseOver() {
        this.bg.setTint(colorToNumber(Color.TransformDarker));
    }
    public onMouseOff() {
        this.bg.setTint();
    }
    public setEnabled(enabled: boolean) {
        if (enabled) {
            this.onMouseOff();
        }
        else {
            this.setTint(colorToNumber(Color.DeepPlum));
        }
    }
    public resize(w: number, h: number) {
        if (this.scene === null || !this.active || !this.bg) {
            return;
        }
        this.bg.setSize(w, h);
    }

    public textColor = Color.DeepPlum;

    public textColorOver = Color.Licorice;

    public setTint(color?: number) {
        this.bg.setTint(color);
    }

    preDestroy() {
        if (this.bg) {
            this.bg.destroy();
        }
    }
}