import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { BIOME_ID, biomeToName } from "../battle/biome";
import { Subscription } from "rxjs";
import { Button } from "../widgets/button";
import { GAME_HEIGHT, GAME_WIDTH, fontStyle } from "../main";
import { MainMenu } from "./main";
import { LevelSelectMenu } from "./level-select";
import { DungeonScene } from "./dungeon-scene";
import { TopBar } from "../widgets/top-bar";
import { QuestsMenu } from "./quests";
import { Color } from "../constants/colors";

export class BiomeSelectMenu extends Phaser.Scene {
    api: DeployedGame2API;
    state: Game2DerivedState;
    isQuest: boolean;
    subscription: Subscription;
    topBar: TopBar | undefined;

    constructor(api: DeployedGame2API, isQuest: boolean, state: Game2DerivedState) {
        super('BiomeSelectMenu');
        this.api = api;
        this.isQuest = isQuest;
        this.state = state;
        this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
    }

    onStateChange(state: Game2DerivedState) {
        this.state = state;
    }

    create() {
        const biomes = [
            BIOME_ID.grasslands,
            BIOME_ID.desert,
            BIOME_ID.tundra,
            BIOME_ID.cave
        ];
        const buttonWidth = 320;
        const buttonHeight = 64;

        // Add and launch dungeon background scene (shared across hub scenes)
        if (!this.scene.get('DungeonScene')) {
            this.scene.add('DungeonScene', new DungeonScene());
        }
        // Only launch if not already running
        const dungeonScene = this.scene.get('DungeonScene');
        if (dungeonScene && !dungeonScene.scene.isActive()) {
            this.scene.launch('DungeonScene');
        }

        // Add title
        this.add.text(
            GAME_WIDTH / 2,
            50,
            'Biome',
            {
                ...fontStyle(18),
                color: Color.White,
                align: 'center'
            }
        ).setOrigin(0.5).setStroke(Color.Licorice, 8);

        const biomeTooltips: Record<number, string> = {
            [BIOME_ID.grasslands]: 'Enemies here are weak to Fire',
            [BIOME_ID.desert]: 'Enemies here are weak to Ice',
            [BIOME_ID.tundra]: 'Enemies here are weak to Physical',
            [BIOME_ID.cave]: 'Mixed enemies with varied weaknesses',
        };

        biomes.forEach((biome, i) => new Button(
            this,
            GAME_WIDTH / 2,
            140 + i * 80,
            buttonWidth,
            buttonHeight,
            biomeToName(biome),
            12,
            () => {
                this.scene.remove('LevelSelectMenu');
                this.scene.add('LevelSelectMenu', new LevelSelectMenu(this.api!, biome, this.isQuest, this.state));
                this.scene.start('LevelSelectMenu');
            },
            biomeTooltips[biome]
        ));
        new TopBar(this, true, this.api, this.state)
            .back(() => {
                if (this.isQuest) {
                    this.scene.remove('QuestsMenu');
                    this.scene.add('QuestsMenu', new QuestsMenu(this.api!, this.state));
                    this.scene.start('QuestsMenu');
                } else {
                    this.scene.remove('MainMenu');
                    this.scene.add('MainMenu', new MainMenu(this.api!, this.state));
                    this.scene.start('MainMenu');
                }
            }, 'Return to Hub');
    }

    shutdown() {
        this.subscription?.unsubscribe();
    }
}