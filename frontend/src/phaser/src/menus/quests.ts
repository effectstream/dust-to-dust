/**
 * Menu to display all active quests and manage quest creation.
 * Shows a list of active quests with a button to start new quests.
 * Includes quest count cap to prevent too many ongoing quests.
 */
import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { Subscription } from "rxjs";
import { Button } from "../widgets/button";
import { GAME_HEIGHT, GAME_WIDTH, logger } from "../main";
import { MainMenu } from "./main";
import { BiomeSelectMenu } from "./biome-select";
import { QuestMenu } from "./quest";
import { QuestConfig } from "game2-contract";
import { biomeToName } from "../constants/biome";
import { DungeonScene } from "./dungeon-scene";
import { TopBar } from "../widgets/top-bar";

export class QuestsMenu extends Phaser.Scene {
    api: DeployedGame2API;
    state: Game2DerivedState;
    subscription: Subscription;
    buttons: Button[];
    private questButtonEntries: { button: Button; quest: QuestConfig }[] = [];
    private timerEvent: Phaser.Time.TimerEvent | undefined;

    // Quest count limit - adjust as needed
    private readonly MAX_ACTIVE_QUESTS = 3;

    constructor(api: DeployedGame2API, state: Game2DerivedState) {
        super('QuestsMenu');
        this.api = api;
        this.state = state;
        this.buttons = [];
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
    }

    private questStr(quest: QuestConfig): string {
        const levelDuration = this.state.questDurations.get(quest.level.biome)?.get(quest.level.difficulty) ?? 1200n;
        const durationSec = Number(levelDuration > 0n ? levelDuration : 1200n);
        const elapsedSec = Math.floor(Date.now() / 1000) - Number(quest.start_time);
        const remainingSec = Math.max(0, durationSec - elapsedSec);
        if (remainingSec <= 0) {
            return `${biomeToName(Number(quest.level.biome))} ${quest.level.difficulty} - Ready!`;
        }
        const minutes = Math.floor(remainingSec / 60);
        const seconds = remainingSec % 60;
        return `${biomeToName(Number(quest.level.biome))} ${quest.level.difficulty} - ${minutes}m ${seconds}s`;
    }

    onStateChange(state: Game2DerivedState) {
        this.state = state;
        // Only refresh display if the scene is active and initialized
        if (this.scene?.manager && this.scene.isActive('QuestsMenu')) {
            this.refreshQuestDisplay();
        }
    }

    create() {
        // Add and launch dungeon background scene first (shared across hub scenes)
        if (!this.scene.get('DungeonScene')) {
            this.scene.add('DungeonScene', new DungeonScene());
        }
        // Only launch if not already running
        const dungeonScene = this.scene.get('DungeonScene');
        if (dungeonScene && !dungeonScene.scene.isActive()) {
            this.scene.launch('DungeonScene');
        }

        new TopBar(this, true, this.api, this.state)
            .back(() => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Back to Hub');
        
        this.refreshQuestDisplay();

        // Update quest timers every second
        this.timerEvent = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                for (const entry of this.questButtonEntries) {
                    entry.button.text.setText(this.questStr(entry.quest));
                }
            },
        });
    }

    private refreshQuestDisplay() {
        // Clear existing buttons
        this.buttons.forEach((b) => b.destroy());
        this.buttons = [];
        this.questButtonEntries = [];

        const activeQuestCount = this.state.quests.size;
        const canStartNewQuest = activeQuestCount < this.MAX_ACTIVE_QUESTS;

        // New Quest button at the top
        const newQuestButton = new Button(
            this, 
            GAME_WIDTH / 2, 
            GAME_HEIGHT * 0.15, 
            320, 
            64, 
            canStartNewQuest ? 'New Quest' : `Quest Limit (${activeQuestCount}/${this.MAX_ACTIVE_QUESTS})`,
            14,
            () => {
                if (canStartNewQuest) {
                    this.scene.remove('BiomeSelectMenu');
                    this.scene.add('BiomeSelectMenu', new BiomeSelectMenu(this.api, true, this.state));
                    this.scene.start('BiomeSelectMenu');
                }
            },
            'Choose a biome and spirits, then wait for the boss to appear'
        );
        
        if (!canStartNewQuest) {
            newQuestButton.setAlpha(0.6); // Dim the button when disabled
        }
        
        this.buttons.push(newQuestButton);

        // Display active quests
        let offset = 0;
        for (const [id, quest] of this.state.quests) {
            logger.gameState.debug(`displaying quest: ${id}`);
            const questButton = new Button(
                this,
                GAME_WIDTH / 2,
                GAME_HEIGHT * 0.333 + 80 * offset,
                480,
                72,
                this.questStr(quest),
                10,
                () => {
                    this.scene.remove('QuestMenu');
                    this.scene.add('QuestMenu', new QuestMenu(this.api, id, this.state));
                    this.scene.start('QuestMenu');
                },
                'View quest status and fight boss when ready'
            );
            this.buttons.push(questButton);
            this.questButtonEntries.push({ button: questButton, quest });
            offset += 1;
        }
    }

    shutdown() {
        this.timerEvent?.destroy();
        this.subscription?.unsubscribe();
    }
}