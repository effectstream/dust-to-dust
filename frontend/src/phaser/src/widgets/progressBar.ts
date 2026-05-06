import Phaser from 'phaser';
import {Color, colorToNumber} from '../constants/colors';
import {fontStyle} from '../main';
import { BASE_SPRITE_SCALE } from '../utils/scaleImage';

export interface ProgressBarConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    min?: number;
    max?: number;
    value?: number;
    barColor?: number;
    bgColor?: number;
    tempBarColor?: number; // if this is present there will be a temporary bar of this color until finalizeTempProgress() is called
    borderWidth?: number;
    borderColor?: Color;
    scene: Phaser.Scene;
    displayTotalCompleted?: boolean; // If true, render the total completed value in text as "{value}/{max}""
    labelText?: string; // Optional text to display in the label
    fontStyle?: Phaser.Types.GameObjects.Text.TextStyle;
    transparent?: boolean; // If true, make bar and background 50% transparent
}

export class ProgressBar extends Phaser.GameObjects.Container {
    protected bar: Phaser.GameObjects.Rectangle;
    protected barTemp: Phaser.GameObjects.Rectangle | undefined;
    protected bg: Phaser.GameObjects.Rectangle;
    protected min: number;
    protected max: number;
    protected _value: number;
    protected widthPx: number;
    protected heightPx: number;
    protected label: Phaser.GameObjects.Text;
    protected labelText: string = '';
    protected displayTotalCompleted: boolean = false;

    constructor(config: ProgressBarConfig) {
        // Center the container at (config.x, config.y)
        super(config.scene, config.x, config.y);

        this.min = config.min ?? 0;
        this.max = config.max ?? 100;
        this._value = config.value ?? this.max;
        this.widthPx = config.width;
        this.heightPx = config.height;
        this.displayTotalCompleted = config.displayTotalCompleted ?? false;

        // All elements are positioned relative to the center
        const halfWidth = this.widthPx / 2;
        const halfHeight = this.heightPx / 2;

        // Add border rectangle (stroke only, no fill)
        const border = config.scene.add.rectangle(
            -halfWidth, -halfHeight,
            config.width, config.height
        );
        const borderWidth = config.borderWidth ?? 8; // Default border width
        const borderColor = config.borderColor ?? Color.White;
        border.setStrokeStyle(borderWidth, colorToNumber(borderColor));
        border.setFillStyle(0x000000, 0); // Set fill alpha to 0 (transparent)
        border.setOrigin(0, 0);

        this.add(border);

        // Background starts at zero width since health starts at max
        this.bg = config.scene.add.rectangle(halfWidth, -halfHeight, 0, this.heightPx, config.bgColor ?? colorToNumber(Color.DeepPlum));
        this.bg.setOrigin(0, 0);
        this.add(this.bg);

        if (config.tempBarColor != undefined) {
            this.barTemp = config.scene.add.rectangle(-halfWidth, -halfHeight, this.widthPx, this.heightPx, config.tempBarColor).setOrigin(0, 0);
            this.add(this.barTemp);
        }

        this.bar = config.scene.add.rectangle(-halfWidth, -halfHeight, this.widthPx, this.heightPx, config.barColor ?? colorToNumber(Color.Turquoise));
        this.bar.setOrigin(0, 0);
        this.add(this.bar);

        // Set bar, background, and temp bar to 50% transparency if requested
        if (config.transparent) {
            this.bar.setAlpha(0.5);
            this.bg.setAlpha(0.5);
            if (this.barTemp) {
                this.barTemp.setAlpha(0.5);
            }
        }

        // Display total completed text if enabled
        this.label = config.scene.add.text(
            0,
            -4,  // Subtract a few pixels to center vertically for our chosen font
            `${this._value} / ${this.max}`,
            config.fontStyle ?? fontStyle(10),
        ).setOrigin(0.5, 0.5);
        this.add(this.label);

        config.scene.add.existing(this);

        this.setValue(this._value);
    }

    setValue(value: number) {
        const newValue = Phaser.Math.Clamp(value, this.min, this.max);
        const newPercent = (newValue - this.min) / (this.max - this.min);
        this._value = newValue;

        const halfWidth = this.widthPx / 2;
        const barWidth = this.widthPx * newPercent;
        const bgWidth = this.widthPx - barWidth;

        // Animate the bar width
        this.scene.tweens.add({
            targets: this.bar,
            width: barWidth,
            duration: 250,
            ease: 'Cubic.Out',
        });

        // Animate the background width and position so it starts where the bar ends
        this.scene.tweens.add({
            targets: this.bg,
            x: -halfWidth + barWidth,
            width: bgWidth,
            duration: 250,
            ease: 'Cubic.Out',
        });

        if (this.shouldDisplayLabel()) {
            this.label.setVisible(true);
            if (this.labelText) {
                this.setLabel(this.labelText);
            } else if (this.displayTotalCompleted) {
                this.setLabel(`${this._value} / ${this.max}`);
            }
        } else {
            this.label.setVisible(false);
        }
    }

    setLabel(label: string) {
        this.label.setText(label);
        this.label.setVisible(true);
    }

    public finalizeTempProgress(onComplete?: () => void) {
        this.scene.tweens.add({
            targets: this.barTemp,
            width: this.bar.width,
            duration: 1000,
            onComplete,
            ease: 'Cubic.Out'
        });
    }

    private shouldDisplayLabel(): boolean {
        return !!(this.labelText || this.displayTotalCompleted);
    }

    get value() {
        return this._value;
    }
}

export class HealthBar extends ProgressBar {
    shield: Phaser.GameObjects.Image;
    blockText: Phaser.GameObjects.Text;

    constructor(config: ProgressBarConfig) {
        super({
            ...config,
            barColor: config.barColor ?? colorToNumber(Color.Red),
            bgColor: config.bgColor ?? colorToNumber(Color.Licorice),
            tempBarColor: config.tempBarColor ?? colorToNumber(Color.DeepPlum),
            transparent: config.transparent,
        });

        const halfWidth = config.width / 2;
        this.shield = this.scene.add.image(-halfWidth, 0, 'hp-bar-shield')
            .setScale(BASE_SPRITE_SCALE)
            .setVisible(false);
        this.blockText = this.scene.add.text(-halfWidth, -4, '', fontStyle(10))
            .setOrigin(0.5, 0.5)
            .setVisible(false);
        this.add(this.shield);
        this.add(this.blockText);
    }

    public setBlock(block: number) {
        if (block > 0) {
            this.shield.setVisible(true);
            this.blockText.setVisible(true).setText(block.toString());
        } else {
            this.shield.setVisible(false);
            this.blockText.setVisible(false);
        }
    }
}