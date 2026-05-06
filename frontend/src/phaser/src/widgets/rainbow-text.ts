import { Color } from "../constants/colors";
import { fontStyle } from "../main";

/**
 * RainbowText widget that displays text with each character colored in rainbow colors
 */
export class RainbowText extends Phaser.GameObjects.Container {
    // 3D Effect Configuration Constants
    private static readonly RIGHT_SIDE_DARKEN = 0.3;  // How much to darken right side (0-1)
    private static readonly BOTTOM_SIDE_DARKEN = 0.5; // How much to darken bottom side (0-1)

    private textObjects: Phaser.GameObjects.Text[] = [];
    private letterGroups: Phaser.GameObjects.Container[] = [];
    private rainbowColors: Color[] = [
        Color.Red,
        Color.Orange, 
        Color.Yellow,
        Color.Green,
        Color.Turquoise,
        Color.Blue,
        Color.Violet
    ];

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        text: string,
        depth: number = 8,
        style?: Phaser.Types.GameObjects.Text.TextStyle,
        centered: boolean = false
    ) {
        super(scene, x, y);
        
        this.createRainbowText(text, style, depth, centered);
        scene.add.existing(this);
    }

    private createRainbowText(text: string, style?: Phaser.Types.GameObjects.Text.TextStyle, depth: number = 0, centered: boolean = false) {
        // Clear existing text objects and letter groups
        this.textObjects.forEach(textObj => textObj.destroy());
        this.letterGroups.forEach(group => group.destroy());
        this.textObjects = [];
        this.letterGroups = [];

        const defaultStyle: Phaser.Types.GameObjects.Text.TextStyle = {
            ...fontStyle(24),
            ...style
        };

        // Split text into lines
        const lines = text.split('\n');
        
        // If centering, first calculate total width of longest line
        let maxLineWidth = 0;
        if (centered) {
            for (const line of lines) {
                let lineWidth = 0;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    const tempText = new Phaser.GameObjects.Text(this.scene, 0, 0, char, defaultStyle);
                    lineWidth += tempText.width;
                    tempText.destroy();
                }
                maxLineWidth = Math.max(maxLineWidth, lineWidth);
            }
        }

        let currentY = centered ? -(lines.length - 1) * 48 / 2 : 0; // 48 is line height with spacing
        let colorIndex = 0; // Track color across all characters
        
        for (const line of lines) {
            // Calculate line width for centering this specific line
            let lineWidth = 0;
            if (centered) {
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    const tempText = new Phaser.GameObjects.Text(this.scene, 0, 0, char, defaultStyle);
                    lineWidth += tempText.width;
                    tempText.destroy();
                }
            }
            
            let currentX = centered ? -lineWidth / 2 : 0;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const faceColor = this.rainbowColors[colorIndex % this.rainbowColors.length];
                colorIndex++;
            
                if (depth > 0) {
                    // Create a container for this letter's 3D layers
                    const letterContainer = new Phaser.GameObjects.Container(this.scene, 0, 0);
                    this.add(letterContainer);
                    this.letterGroups.push(letterContainer);
                    
                    // Calculate darker colors for the 3D sides
                    const rightSideColor = this.darkenColor(faceColor, RainbowText.RIGHT_SIDE_DARKEN);
                    const bottomSideColor = this.darkenColor(faceColor, RainbowText.BOTTOM_SIDE_DARKEN);
                    
                    // Create the 3D effect with multiple text layers using the depth value
                    // Bottom side (darkest, offset by depth)
                    const bottomSideStyle = { ...defaultStyle, color: bottomSideColor };
                    const bottomSideObj = new Phaser.GameObjects.Text(this.scene, currentX + depth, currentY + depth, char, bottomSideStyle);
                    bottomSideObj.setOrigin(0, 0);
                    letterContainer.add(bottomSideObj);
                    this.textObjects.push(bottomSideObj);
                    
                    // Right side (medium dark, offset by half depth)
                    const rightSideStyle = { ...defaultStyle, color: rightSideColor };
                    const rightSideObj = new Phaser.GameObjects.Text(this.scene, currentX + depth/2, currentY + depth/2, char, rightSideStyle);
                    rightSideObj.setOrigin(0, 0);
                    letterContainer.add(rightSideObj);
                    this.textObjects.push(rightSideObj);
                    
                    // Face (brightest, on top)
                    const faceStyle = { ...defaultStyle, color: faceColor };
                    const faceObj = new Phaser.GameObjects.Text(this.scene, currentX, currentY, char, faceStyle);
                    faceObj.setOrigin(0, 0);
                    letterContainer.add(faceObj);
                    this.textObjects.push(faceObj);
                    
                    // Move X position for next character based on the width of the face character
                    currentX += faceObj.width;
                } else {
                    // Simple 2D text
                    const charStyle = { ...defaultStyle, color: faceColor };
                    const textObj = new Phaser.GameObjects.Text(this.scene, currentX, currentY, char, charStyle);
                    textObj.setOrigin(0, 0);
                    
                    const letterContainer = new Phaser.GameObjects.Container(this.scene, 0, 0);
                    letterContainer.add(textObj);
                    this.add(letterContainer);
                    this.letterGroups.push(letterContainer);
                    this.textObjects.push(textObj);
                    
                    // Move X position for next character based on the width of current character
                    currentX += textObj.width;
                }
            }
            
            // Move to next line
            currentY += 48; // Line height with proper spacing
        }
    }

    /**
     * Darken a color by a given factor for 3D effect
     */
    private darkenColor(color: Color, factor: number): string {
        const hexColor = color.replace('#', '');
        const r = parseInt(hexColor.substring(0, 2), 16);
        const g = parseInt(hexColor.substring(2, 4), 16);
        const b = parseInt(hexColor.substring(4, 6), 16);
        
        const darkenedR = Math.max(0, Math.floor(r * (1 - factor)));
        const darkenedG = Math.max(0, Math.floor(g * (1 - factor)));
        const darkenedB = Math.max(0, Math.floor(b * (1 - factor)));
        
        return `#${darkenedR.toString(16).padStart(2, '0')}${darkenedG.toString(16).padStart(2, '0')}${darkenedB.toString(16).padStart(2, '0')}`;
    }

    /**
     * Update the text content while maintaining rainbow effect
     */
    public setText(newText: string, style?: Phaser.Types.GameObjects.Text.TextStyle, depth: number = 8, centered: boolean = false) {
        this.createRainbowText(newText, style, depth, centered);
    }

    /**
     * Get the total width of the rainbow text
     */
    getTextWidth(): number {
        return this.textObjects.reduce((total, textObj) => total + textObj.width, 0);
    }

    /**
     * Get the height of the text (assumes all characters have same height)
     */
    getTextHeight(): number {
        return this.textObjects.length > 0 ? this.textObjects[0].height : 0;
    }
}