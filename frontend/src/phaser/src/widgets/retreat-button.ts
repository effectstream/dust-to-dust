/**
 * RetreatButton - A button that peeks from the corner and expands on hover
 */
import { fontStyle } from "../main";
import BBCodeText from 'phaser3-rex-plugins/plugins/bbcodetext.js';
import { BG_TYPE, makeWidgetBackground, WidgetBackground } from "./widget-background";

const peekAmount = 4; // How much of the button is visible when collapsed

export class RetreatButton extends Phaser.GameObjects.Container {
    bg: WidgetBackground & Phaser.GameObjects.GameObject;
    enabled: boolean = true;
    text: BBCodeText;
    soundOnClick: boolean;
    private isExpanded: boolean = false;
    private expandTween: Phaser.Tweens.Tween | null = null;

    private readonly buttonWidth = 120;
    private readonly buttonHeight = 40;
    private readonly collapsedX: number;
    private readonly collapsedY: number;

    constructor(scene: Phaser.Scene, cornerX: number, cornerY: number, onClick: () => void, soundOnClick = true) {
        // Calculate initial position so only peekAmount x peekAmount is visible in the corner
        // Container position is at its center by default
        const initialX = cornerX - (peekAmount / 2);
        const initialY = cornerY + (peekAmount / 2);

        super(scene, initialX, initialY);

        this.collapsedX = initialX;
        this.collapsedY = initialY;

        this.soundOnClick = soundOnClick;

        this.bg = makeWidgetBackground(scene, 0, 0, this.buttonWidth, this.buttonHeight, BG_TYPE.Stone);
        this.add(this.bg);

        // @ts-expect-error
        this.text = scene.add.rexBBCodeText(0, -3, 'Retreat', fontStyle(10, { color: this.bg.textColor, wordWrap: { width: this.buttonWidth - 8 } }))
            .setOrigin(0.5, 0.65);

        this.add(this.text);

        this.setSize(this.buttonWidth, this.buttonHeight);
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
                // Collapse the button when clicked
                this.collapseButton();
                onClick();
            }
        });
        this.on('pointerover', () => {
            if (this.enabled) {
                this.expandButton();
                this.bg.onMouseOver();
                (this.scene.game.canvas as HTMLCanvasElement).style.cursor = 'pointer';
                this.text.setColor(this.bg.textColorOver);
            }
        });
        this.on('pointerout', () => {
            if (this.enabled) {
                this.collapseButton();
                this.bg.onMouseOff();
                (this.scene.game.canvas as HTMLCanvasElement).style.cursor = 'default';
                this.text.setColor(this.bg.textColor);
            }
        });

        scene.add.existing(this);
    }

    private expandButton() {
        if (this.isExpanded) return;

        this.isExpanded = true;

        // Cancel any existing tween
        if (this.expandTween) {
            this.expandTween.stop();
        }

        // Expand to align with top and right edges
        // Button should be flush with the right edge and top edge when expanded
        // Center should be at (GAME_WIDTH - buttonWidth/2, buttonHeight/2)
        const targetX = this.collapsedX - (this.buttonWidth / 2 - peekAmount / 2);
        const targetY = this.buttonHeight / 2;

        this.expandTween = this.scene.tweens.add({
            targets: this,
            x: targetX,
            y: targetY,
            duration: 200,
            ease: 'Back.easeOut'
        });
    }

    private collapseButton() {
        if (!this.isExpanded) return;

        this.isExpanded = false;

        // Cancel any existing tween
        if (this.expandTween) {
            this.expandTween.stop();
        }

        // Return to collapsed position
        this.expandTween = this.scene.tweens.add({
            targets: this,
            x: this.collapsedX,
            y: this.collapsedY,
            duration: 200,
            ease: 'Back.easeIn'
        });
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        this.bg.setEnabled(enabled);
        return this;
    }

    destroy() {
        if (this.expandTween) {
            this.expandTween.stop();
        }
        super.destroy();
    }
}
