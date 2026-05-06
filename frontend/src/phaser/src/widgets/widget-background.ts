import { Color } from "../constants/colors";
import { ParchmentScroll } from "./parchment-scroll";
import { StoneBackground } from "./stone-background";

export interface WidgetBackground {
    tweenIn(extraProps?: any): void;
    tweenOut(extraProps?: any): void;
    onMouseOver(): void;
    onMouseOff(): void;
    resize(w: number, h: number): void;
    setTint(color: number): void;
    setEnabled(enabled: boolean): void;
    textColor: Color;
    textColorOver: Color;
}

export enum BG_TYPE {
    Parchment,
    Stone,
}

export function makeWidgetBackground(scene: Phaser.Scene, x: number, y: number, w: number, h: number, bgType: BG_TYPE): WidgetBackground & Phaser.GameObjects.GameObject {
    switch (bgType) {
        case BG_TYPE.Parchment:
            return new ParchmentScroll(scene, x, y, w, h, false);
        case BG_TYPE.Stone:
            return new StoneBackground(scene, x, y, w, h);
    }
}