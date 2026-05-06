/**
 * Boot scene - handles initial setup and contract deployment
 * Runs once at startup, then redirects to MainMenu or rejoins active battle
 */
import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { BrowserDeploymentManager } from "../proving/wallet";
import { Button } from "../widgets/button";
import { logger, networkId } from "../main";
import { MockGame2API } from "../mockapi";
import { MainMenu } from "./main";
import { ActiveBattle } from "./battle";
import { registerStartingContent } from "game-content";
import { Subscription } from "rxjs";
import { createSpiritAnimations } from "../animations/spirit";
import { createEnemyAnimations } from "../animations/enemy";
import { toBech32mDust, toBech32mShieldAddr } from "../bech32-utils";

export class BootScene extends Phaser.Scene {
    private deployProvider: BrowserDeploymentManager;
    private buttons: Button[] = [];
    private api: DeployedGame2API | undefined;
    private subscription: Subscription | undefined;

    constructor() {
        super('BootScene');
        this.deployProvider = new BrowserDeploymentManager();
    }

    preload() {
        this.load.setBaseURL('/');

        // UI Sprites
        this.load.image('ui-scroll-bg', 'ui-scroll-bg.png');
        this.load.image('tablet0', 'tablet0.png');
        this.load.image('tablet1', 'tablet1.png');
        this.load.image('tablet2', 'tablet2.png');
        this.load.image('tablet-round', 'tablet-round.png');
        this.load.image('lock-icon', 'lock-icon.png');

        // Icon sprites
        this.load.image('fire', 'fire.png');
        this.load.image('ice', 'ice.png');
        this.load.image('physical', 'physical.png');
        this.load.image('block', 'block.png');
        this.load.image('heal', 'heal.png');
        this.load.image('energy-icon', 'energy-icon.png');
        this.load.image('arrow', 'arrow.png');
        this.load.image('aoe', 'aoe.png');
        this.load.image('hp-bar-shield', 'hp-bar-shield.png');
        this.load.image('upgrade-star', 'upgrade-star.png');
        this.load.image('upgrade-star-slot', 'upgrade-star-slot.png');
        this.load.image('upgrade-star-background', 'upgrade-star-background.png');

        // Revolving Orb Sprites
        this.load.image('orb-atk-fire', 'orb-atk-fire.png');
        this.load.image('orb-atk-ice', 'orb-atk-ice.png');
        this.load.image('orb-atk-phys', 'orb-atk-phys.png');
        this.load.image('orb-def', 'orb-def.png');

        // Spirit Sprites
        this.load.spritesheet('spirit-atk-fire', 'spirit-atk-fire.png', { frameWidth: 64, frameHeight: 64 });
        this.load.spritesheet('spirit-atk-ice', 'spirit-atk-ice.png', { frameWidth: 64, frameHeight: 64 });
        this.load.spritesheet('spirit-atk-phys', 'spirit-atk-phys.png', { frameWidth: 64, frameHeight: 64 });
        this.load.spritesheet('spirit-def', 'spirit-def.png', { frameWidth: 64, frameHeight: 64 });

        this.load.spritesheet('orb-aura', 'orb-aura.png', { frameWidth: 16, frameHeight: 16 });
        this.load.spritesheet('spirit-aura', 'spirit-aura.png', { frameWidth: 32, frameHeight: 32 });

        // Enemy Sprites
        this.load.spritesheet('enemy-goblin', 'enemy-goblin.png', { frameWidth: 32, frameHeight: 28 });
        this.load.spritesheet('enemy-hellspawn', 'enemy-hellspawn.png', { frameWidth: 61, frameHeight: 47 });
        this.load.spritesheet('enemy-fire-sprite', 'enemy-fire-sprite.png', { frameWidth: 43, frameHeight: 35 });
        this.load.spritesheet('enemy-ice-golem', 'enemy-ice-golem.png', { frameWidth: 44, frameHeight: 40 });
        this.load.spritesheet('enemy-snowman', 'enemy-snowman.png', { frameWidth: 40, frameHeight: 40 });
        this.load.spritesheet('enemy-coyote', 'enemy-coyote.png', { frameWidth: 60, frameHeight: 35 });
        this.load.spritesheet('enemy-pyramid', 'enemy-pyramid.png', { frameWidth: 80, frameHeight: 80 });
        this.load.spritesheet('enemy-goblin-priest', 'enemy-goblin-priest.png', { frameWidth: 32, frameHeight: 32 });
	    this.load.spritesheet('enemy-goblin-swordmaster', 'enemy-goblin-swordmaster.png', { frameWidth: 47, frameHeight: 32  });
        this.load.spritesheet('enemy-tentacle', 'enemy-tentacle.png', { frameWidth: 18, frameHeight: 57  });
        this.load.spritesheet('enemy-miniboss-goblin-chief', 'enemy-miniboss-goblin-chief.png', { frameWidth: 64, frameHeight: 56  });
        this.load.spritesheet('enemy-miniboss-tentacles', 'enemy-miniboss-tentacles.png', { frameWidth: 64, frameHeight: 64 });

        this.load.spritesheet('enemy-boss-enigma', 'enemy-boss-enigma-1.png', { frameWidth: 152, frameHeight: 95 });
        this.load.spritesheet('enemy-boss-dragon', 'enemy-boss-dragon-1.png', { frameWidth: 145, frameHeight: 97 });
        this.load.spritesheet('enemy-boss-abominable', 'enemy-boss-abominable.png', { frameWidth: 130, frameHeight: 98 });
        this.load.spritesheet('enemy-boss-sphinx', 'enemy-boss-sphinx.png', { frameWidth: 80, frameHeight: 94 });

        // Combat Effects
        this.load.image('heal-effect-circle', 'heal-effect-circle.png');
        this.load.image('heal-effect-rays', 'heal-effect-rays.png');

        // Backgrounds
        this.load.image('bg-hub1', 'bg-hub1.png');
        this.load.image('bg-shop', 'bg-shop.png');
        this.load.image('bg-grass', 'bg-grass.png');
        this.load.image('bg-desert', 'bg-desert.png');
        this.load.image('bg-tundra', 'bg-tundra.png');
        this.load.image('bg-cave', 'bg-cave.png');

        // Sound Effects
        this.load.audio('attack-immune', 'sfx/attack-immune.ogg');
        this.load.audio('attack-weak', 'sfx/attack-weak.ogg');
        this.load.audio('attack-neutral', 'sfx/attack-neutral.ogg');
        this.load.audio('attack-effective', 'sfx/attack-effective.ogg');
        this.load.audio('attack-supereffective', 'sfx/attack-supereffective.ogg');
        this.load.audio('battle-select-enemy', 'sfx/battle-select-enemy.ogg');
        this.load.audio('battle-select-enemy-attack', 'sfx/battle-select-enemy-attack.ogg');
        this.load.audio('battle-win', 'sfx/battle-win.ogg');
        this.load.audio('battle-lose', 'sfx/battle-lose.ogg');
        this.load.audio('battle-ice-attack', 'sfx/battle-ice-attack.ogg');
        this.load.audio('battle-phys-attack', 'sfx/battle-phys-attack.ogg');
        this.load.audio('battle-fire-attack', 'sfx/battle-fire-attack.ogg');
        this.load.audio('battle-def', 'sfx/battle-def.ogg');
        this.load.audio('prebattle-move-spirit', 'sfx/prebattle-move-spirit.ogg');
        this.load.audio('button-press-1', 'sfx/button-press-1.ogg');
        this.load.audio('upgrade-success', 'sfx/upgrade-success.ogg');

        // Music
        this.load.audio('menu-music', 'music/menu.ogg');
        this.load.audio('boss-battle-music', 'music/boss-battle-music.ogg');

        this.load.plugin('rexdragplugin', 'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexdragplugin.min.js', true);
        this.load.plugin('rexroundrectangleplugin', 'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexroundrectangleplugin.min.js', true);
 
    }

    create() {
        // Create animations
        createSpiritAnimations(this);
        createEnemyAnimations(this);

        // Check if we're in mock mode first - mock mode doesn't use real contracts
        if (import.meta.env.VITE_API_FORCE_DEPLOY === 'mock') {
            logger.network.info('==========MOCK API========');
            this.createDefaultContent(new MockGame2API());
        } else {
            // Check if we should join an existing contract (only for real deployments)
            const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
            if (contractAddress) {
                logger.network.info(`Joining existing contract: ${contractAddress}`);
                this.deployProvider.join(contractAddress).then((api) => {
                    logger.network.info('==========JOINED CONTRACT========');
                    this.initApi(api);
                }).catch((e) => logger.network.error(`Error joining contract: ${e}`));
            } else {
                // Original deploy logic
                switch (import.meta.env.VITE_API_FORCE_DEPLOY) {
                    case 'real':
                        logger.network.info('~deploying~');
                        this.deployProvider.create().then((api) => {
                            logger.network.info('==========GOT API========');
                            this.createDefaultContent(api);
                        }).catch((e) => logger.network.error(`Error connecting: ${e}`));
                        break;
                    default:
                        if (import.meta.env.VITE_API_FORCE_DEPLOY != undefined) {
                            logger.debugging.error(`Unknown VITE_API_FORCE_DEPLOY: ${import.meta.env.VITE_API_FORCE_DEPLOY}`);
                        }
                        this.buttons.push(new Button(this, 75, 48, 128, 84, 'Deploy', 10, () => {
                            logger.network.info('~deploying~');
                            this.deployProvider.create().then((api) => {
                                logger.network.info('==========GOT API========');
                                this.createDefaultContent(api);
                            }).catch((e) => logger.network.error(`Error connecting: ${e}`));
                        }));
                        this.buttons.push(new Button(this, 215, 48, 128, 84, 'Mock Deploy', 10, () => {
                            logger.network.info('==========MOCK API========');
                            this.createDefaultContent(new MockGame2API());
                        }));
                        break;
                }
            }
        }
    }

    private createDefaultContent(api: DeployedGame2API) {
        // Always register full content by default
        // To use minimal content, set VITE_MINIMAL_CONTENT=true in your .env
        const minimalOnly = import.meta.env.VITE_MINIMAL_CONTENT === 'true';
        registerStartingContent(api, minimalOnly, logger.network).then(() => this.initApi(api))
    }

    private initApi(api: DeployedGame2API) {
        this.buttons.forEach((b) => b.destroy());
        this.api = api;

        // Subscribe to state to check for active battles (only first emission)
        let handled = false;
        this.subscription = api.state$.subscribe((state) => {
            // Ensure we only handle the first state emission
            if (handled) return;
            handled = true;

            // Unsubscribe immediately
            this.subscription?.unsubscribe();
            this.subscription = undefined;

            // Debug logging
            logger.gameState.info(`Boot state check: player=${state.player !== undefined}, playerId=${state.playerId}, activeBattles=${state.activeBattleConfigs.size}`);

            // Expose player addresses as Bech32 for the overlays (achievements, leaderboard)
            if (state.playerId) {
                (window as any).__d2dPlayerAddress = toBech32mDust(state.playerId, networkId);
            }
            if (state.myDelegatedAddress) {
                // On-chain stores the full 64-byte shielded address; bech32m-encode for display.
                (window as any).__d2dWalletAddress = toBech32mShieldAddr(state.myDelegatedAddress, networkId);
            }

            // Check if player has an active battle
            if (state.player !== undefined) {
                const activeBattle = this.findPlayerActiveBattle(state);
                if (activeBattle) {
                    logger.gameState.info(`Active battle detected on boot - rejoining battle ${activeBattle.id}`);
                    this.rejoinBattle(api, activeBattle.config, state);
                    return;
                }
            }

            // No active battle, navigate to MainMenu
            // Remove any existing MainMenu scene first to avoid duplicate key errors
            if (this.scene.get('MainMenu')) {
                this.scene.remove('MainMenu');
            }
            this.scene.add('MainMenu', new MainMenu(api, state));
            this.scene.start('MainMenu');
        });
    }

    /**
     * Find any active battle belonging to the current player
     */
    private findPlayerActiveBattle(state: Game2DerivedState): { config: any, id: bigint } | undefined {
        if (!state.player || !state.playerId) {
            return undefined;
        }

        // Look through all active battle configs for one belonging to this player
        for (const [battleId, config] of state.activeBattleConfigs) {
            if (config.player_pub_key === state.playerId) {
                logger.gameState.debug(`Found active battle for player: ${battleId}`);
                return { config, id: battleId };
            }
        }

        return undefined;
    }

    /**
     * Rejoin an existing active battle
     */
    private rejoinBattle(api: DeployedGame2API, battleConfig: any, state: Game2DerivedState) {
        logger.gameState.info('Rejoining active battle from boot...');
        this.scene.add('ActiveBattle', new ActiveBattle(api, battleConfig, state));
        this.scene.start('ActiveBattle');
    }
}
