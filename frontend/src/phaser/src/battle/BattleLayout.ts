import { BattleConfig } from "game2-contract";

export class BattleLayout {
    private gameWidth: number;
    private gameHeight: number;

    constructor(gameWidth: number, gameHeight: number) {
        this.gameWidth = gameWidth;
        this.gameHeight = gameHeight;
    }

    // Ability positioning
    abilityInUseY(): number {
        return this.gameHeight * 0.7;
    }

    abilityIdleY(): number {
        return this.gameHeight * 0.75;
    }

    // Enemy positioning
    enemyX(config: BattleConfig, enemyIndex: number): number {
        return this.gameWidth * (enemyIndex + 0.5) / Number(config.enemies.count);
    }

    enemyY(): number {
        return this.gameHeight * 0.23;
    }

    // Player positioning
    playerX(): number {
        return this.gameWidth / 2;
    }

    playerY(): number {
        return this.gameHeight * 0.95;
    }

    // Spirit positioning
    spiritX(spiritIndex: number): number {
        return this.gameWidth * (spiritIndex + 0.5) / 3;
    }

    spiritY(): number {
        return this.gameHeight * 0.5;
    }

    // Fight button positioning
    fightButtonX(): number {
        return this.gameWidth / 2;
    }

    fightButtonY(): number {
        return this.gameHeight * 0.90;
    }
}