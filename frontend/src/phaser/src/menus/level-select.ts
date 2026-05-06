import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { BIOME_ID, biomeToName, biomeToBackground } from "../battle/biome";
import { getQuestDurationSec } from "game-content";
import { Subscription } from "rxjs";
import { Button } from "../widgets/button";
import { GAME_HEIGHT, GAME_WIDTH, fontStyle } from "../main";
import { BiomeSelectMenu } from "./biome-select";
import { StartBattleMenu } from "./pre-battle";
import { DungeonScene } from "./dungeon-scene";
import { TopBar } from "../widgets/top-bar";
import { addScaledImage } from "../utils/scaleImage";
import { Color } from "../constants/colors";
import { addTooltip } from "../widgets/tooltip";
import { LEVEL_COUNT_PER_BIOME } from "game2-contract";
import { MockGame2API } from "../mockapi";

export class LevelSelectMenu extends Phaser.Scene {
    api: DeployedGame2API;
    state: Game2DerivedState;
    isQuest: boolean;
    biome: BIOME_ID;
    subscription: Subscription;
    topBar: TopBar | undefined;

    constructor(api: DeployedGame2API, biome: BIOME_ID, isQuest: boolean, state: Game2DerivedState) {
        super('LevelSelectMenu');
        this.api = api;
        this.biome = biome;
        this.isQuest = isQuest;
        this.state = state;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
    }

    onStateChange(state: Game2DerivedState) {
        this.state = state;
    }

    create() {
        // Set biome-specific background
        addScaledImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, biomeToBackground(this.biome)).setDepth(-10);

        // Add and launch dungeon background scene (shared across hub scenes)
        if (!this.scene.get('DungeonScene')) {
            this.scene.add('DungeonScene', new DungeonScene());
        }
        // Only launch if not already running
        const dungeonScene = this.scene.get('DungeonScene');
        if (dungeonScene && !dungeonScene.scene.isActive()) {
            this.scene.launch('DungeonScene');
        }

        // Create title
        this.add.text(
            GAME_WIDTH / 2,
            40,
            `${biomeToName(this.biome)}`,
            {
                ...fontStyle(16),
                color: Color.White,
                align: 'center'
            }
        ).setOrigin(0.5).setStroke(Color.Licorice, 8);
        this.add.text(
            GAME_WIDTH / 2,
            90,
            this.isQuest ? `Select Boss Quest Level` : `Select Level`,
            {
                ...fontStyle(12),
                color: Color.White,
                align: 'center'
            }
        ).setOrigin(0.5).setStroke(Color.Licorice, 8);

        // Create level buttons
        const buttonWidth = 320;
        const buttonHeight = 64;
        const startY = GAME_HEIGHT * 0.35;
        const spacingY = 100;

        this.createLevelButtons(LEVEL_COUNT_PER_BIOME, buttonWidth, buttonHeight, startY, spacingY);

        new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('BiomeSelectMenu');
                this.scene.add('BiomeSelectMenu', new BiomeSelectMenu(this.api!, this.isQuest, this.state));
                this.scene.start('BiomeSelectMenu');
            }, 'Back to Biome Select');
    }

    private createLevelButtons(maxLevels: number, buttonWidth: number, buttonHeight: number, startY: number, spacingY: number) {
        // Get unlock states from game state
        const unlockedStates: { [level: number]: boolean } = {};
        const biomeProgress = this.state.playerBossProgress.get(BigInt(this.biome));

        for (let level = 1; level <= maxLevels; level++) {
            if (level === 1) {
                // Level 1 is always unlocked
                unlockedStates[level] = true;
            } else {
                // Check if previous level boss was completed
                const prevLevel = level - 1;
                unlockedStates[level] = biomeProgress?.get(BigInt(prevLevel)) ?? false;
            }
        }

        // Create buttons with the unlock states
        for (let level = 1; level <= maxLevels; level++) {
            const isUnlocked = unlockedStates[level];
            const baseLevelName = this.getLevelName(level);
            const levelName = this.isQuest
                ? `${baseLevelName} (${getQuestDurationSec(this.biome, level) / 60}m)`
                : baseLevelName;

            const button = new Button(
                this,
                GAME_WIDTH / 2,
                startY + (level - 1) * spacingY,
                buttonWidth,
                buttonHeight,
                levelName,
                12,
                () => {
                    if (isUnlocked) {
                        this.scene.remove('StartBattleMenu');
                        this.scene.add('StartBattleMenu', new StartBattleMenu(this.api!, this.biome, this.isQuest, this.state, level));
                        this.scene.start('StartBattleMenu');
                    }
                },
            );

            // to quickly test for balance we can instantly get rewards from battles or quests here
            // this only works on mock api
            if (import.meta.env.VITE_QUICK_TEST_REWARDS && isUnlocked) {
                new Button(
                    this,
                    GAME_WIDTH / 2 + buttonWidth / 2 + 48 + 16,
                    startY + (level - 1) * spacingY,
                    96,
                    buttonHeight,
                    "Auto\nWin",
                    8,
                    () => {
                        const levelId = { biome: BigInt(this.biome), difficulty: BigInt(level) };
                        // this gives rewards and also unlocks next boss - note: you need to back out to refresh it unlocking next boss though
                        (this.api as MockGame2API).quickTestBattle(levelId, this.isQuest);
                    },
                );
            }

            // Disable button if level is locked
            if (isUnlocked) {
                const tooltipText = `${this.getLevelOrdinal(level)} Level. Beat quest boss to unlock ${this.getLevelName(level + 1)}.`;
                addTooltip(this, button, tooltipText);

            } else {
                button.setEnabled(false);

                const tooltipText = `Complete ${this.getLevelName(level - 1)} Level Quest Boss`;
                addTooltip(this, button, tooltipText);

                // Add lock icon as visual indicator with tooltip
                const lockIcon = addScaledImage(
                    this,
                    GAME_WIDTH / 2 + buttonWidth / 2 + 30,
                    (startY + (level - 1) * spacingY) - 2,
                    'lock-icon'
                ).setOrigin(0.5);

                // Add subtle rotation animation to the lock icon
                lockIcon.setRotation(-0.1);
                this.tweens.add({
                    targets: lockIcon,
                    rotation: 0.1, // Rotate from left (-0.1) to right (0.1)
                    duration: 2000, // 2 seconds for full left-to-right cycle
                    ease: 'Sine.easeInOut',
                    yoyo: true, // Return back (right to left)
                    repeat: -1, // Repeat infinitely
                    delay: level * 100 // Stagger the animations
                });

                // Add tooltip to the lock icon
                if (tooltipText) {
                    addTooltip(this, lockIcon, tooltipText);
                }
            }
        }
    }


    private getLevelName(level: number): string {
        switch (level) {
            case 1:
                return 'Frontier';
            case 2:
                return 'Interior';
            case 3:
                return 'Stronghold';
            default:
                return `Level ${level}`;
        }
    }

    private getLevelOrdinal(level: number): string {
        switch (level) {
            case 1:
                return 'First';
            case 2:
                return 'Second';
            case 3:
                return 'Third';
            case 4:
                return 'Fourth';
            case 5:
                return 'Fifth';
            case 6:
                return 'Sixth';
            case 7:
                return 'Seventh';
            default:
                return `${level}th`;
        }
    }
}