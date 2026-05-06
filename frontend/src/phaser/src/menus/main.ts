/**
 * Main hub menu - the primary game menu after boot/initialization.
 *
 * This contains a list of active quests as well as buttons to initiate new quests or new battles.
 */
import { DeployedGame2API, Game2DerivedState } from "game2-api";
import { Button } from "../widgets/button";
import { Subscription } from "rxjs";
import { txSpinner } from "../tx-spinner";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, logger, networkId } from "../main";
import { toBech32mDust, shortBech32, decodeBech32mBytes } from '../bech32-utils';
import { ShopMenu } from "./shop/shop";
import { BiomeSelectMenu } from "./biome-select";
import { QuestsMenu } from "./quests";
import { DungeonScene } from "./dungeon-scene";
import { TopBar, TOP_BAR_OFFSET } from "../widgets/top-bar";
import { NetworkError } from "./network-error";

// ---------------------------------------------------------------------------
// Delegation overlay helpers
// ---------------------------------------------------------------------------

function showDelegationOverlay(content: HTMLElement): void {
    let overlay = document.getElementById('d2d-delegation-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'd2d-delegation-overlay';
    overlay.className = 'd2d-overlay';
    const box = document.createElement('div');
    box.className = 'd2d-overlay-box';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.className = 'd2d-overlay-close';
    closeBtn.onclick = () => overlay!.remove();

    box.appendChild(closeBtn);
    box.appendChild(content);
    overlay.appendChild(box);
    // Consume all pointer events so clicks don't pass through to the Phaser canvas
    for (const evt of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'] as const) {
        overlay.addEventListener(evt, (e) => e.stopPropagation());
    }
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target === overlay) overlay!.remove();
    });
    document.body.appendChild(overlay);
}

function makeWalletDelegationButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    api: DeployedGame2API,
    hasDelegation: boolean,
    localPublicKey?: bigint | null,
): Button {
    const label = hasDelegation ? 'Linked' : 'Link Wallet';
    const button = new Button(scene, x, y, 120, 40, label, 7, async () => {
        const midnight = (window as any).midnight;

        // No wallet installed at all — prompt to download
        if (!midnight) {
            const content = document.createElement('div');
            content.innerHTML = `
                <p class="d2d-popup-title">Download Wallet</p>
                <p class="d2d-popup-body">Download your Midnight Wallet</p>
                <a href="https://lace.io" target="_blank" rel="noopener noreferrer"
                   class="d2d-btn-primary" style="display:inline-block; text-align:center; font-size:18px;">
                    https://lace.io
                </a>
            `;
            showDelegationOverlay(content);
            return;
        }

        const wallets = Object.entries(midnight).filter(([_, w]: [string, any]) =>
            w.apiVersion && w.apiVersion >= '1.0.0'
        ) as [string, any][];

        if (wallets.length === 0) {
            const content = document.createElement('div');
            content.innerHTML = `
                <p class="d2d-popup-title">No Compatible Wallet</p>
                <p class="d2d-popup-body">A Midnight wallet was detected but no compatible version found.</p>
            `;
            showDelegationOverlay(content);
            return;
        }

        const [, walletApi] = wallets[0];
        // Sanitize wallet name for safe display
        const walletDisplayName = typeof walletApi.name === 'string'
            ? walletApi.name.replace(/[<>&"']/g, '')
            : 'Wallet';

        const content = document.createElement('div');
        content.innerHTML = `
            <p class="d2d-popup-title">Link ${walletDisplayName}</p>
            <p class="d2d-popup-body">Save and link your progress to your ${walletDisplayName} wallet for the leaderboard.</p>
            <div style="text-align:center;">
                <button class="d2d-btn-primary" id="d2d-confirm-link" style="display:inline-block; font-size:18px;">Confirm</button>
            </div>
        `;
        showDelegationOverlay(content);

        document.getElementById('d2d-confirm-link')!.onclick = async () => {
            const overlay = document.getElementById('d2d-delegation-overlay');

            try {
                logger.network.info(`[wallet-delegation] Connecting to wallet: ${walletDisplayName}`);
                const connected = await walletApi.connect(networkId);

                const addresses = await connected.getShieldedAddresses();
                const shieldedAddrStr = addresses.shieldedAddress;
                if (!shieldedAddrStr || typeof shieldedAddrStr !== 'string' || !shieldedAddrStr.startsWith('mn_shield-addr')) {
                    logger.network.warn(`[wallet-delegation] Unexpected shieldedAddress: ${shieldedAddrStr}`);
                    return;
                }

                // Decode the bech32m mn_shield-addr to 64 raw bytes (coin_pub_key || enc_pub_key).
                const addressBytes = decodeBech32mBytes(shieldedAddrStr);
                if (addressBytes.length !== 64) {
                    logger.network.warn(`[wallet-delegation] Expected 64 bytes from shieldedAddress, got ${addressBytes.length}`);
                    return;
                }

                const fromLabel = localPublicKey != null ? shortBech32(toBech32mDust(localPublicKey, networkId)) : 'your game account';
                const walletLabel = shortBech32(shieldedAddrStr);

                // Dismiss the overlay and show the tx spinner like other sections
                if (overlay) overlay.remove();
                txSpinner.show("Generating Proof");

                await api.registerDelegation(addressBytes);

                // Update live window var since boot.ts only runs once and may have missed this delegation.
                (window as any).__d2dWalletAddress = shieldedAddrStr;

                txSpinner.hide();
                const successContent = document.createElement('div');
                successContent.innerHTML = `
                    <p class="d2d-popup-title">Wallet Linked!</p>
                    <p class="d2d-popup-body">Successfully linked</p>
                    <p class="d2d-popup-accent">Game Account ${fromLabel}</p>
                    <p class="d2d-popup-body">to</p>
                    <p class="d2d-popup-accent" style="margin-bottom:20px">Wallet ${walletLabel}</p>
                `;
                showDelegationOverlay(successContent);
            } catch (err) {
                txSpinner.hide();
                logger.network.error(`[wallet-delegation] Failed: ${err}`);
                const errContent = document.createElement('div');
                errContent.innerHTML = `
                    <p class="d2d-popup-title">Linking Failed</p>
                    <p class="d2d-popup-error">${err instanceof Error ? err.message : 'Unknown error'}</p>
                `;
                showDelegationOverlay(errContent);
            }
        };
    }, 'Link your Midnight wallet for the leaderboard');
    return button;
}

// ---------------------------------------------------------------------------
// MainMenu scene
// ---------------------------------------------------------------------------

export class MainMenu extends Phaser.Scene {
    api: DeployedGame2API;
    subscription: Subscription | undefined;
    state: Game2DerivedState | undefined;
    topBar: TopBar | undefined;
    buttons: Button[];
    delegationButton: Button | undefined;
    menuMusic: Phaser.Sound.BaseSound | undefined;
    private isDestroyed: boolean = false;
    private registering: boolean = false;

    constructor(api: DeployedGame2API, state?: Game2DerivedState) {
        super('MainMenu');
        this.api = api;
        this.buttons = [];
        this.state = state;
        setTimeout(() => {
            this.initApi();
        }, 100);
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

        // Initialize UI immediately since we're coming from BootScene with initialized API
        // Scene status is CREATING during create(), so we bypass onStateChange's status check
        if (this.state) {
            this.initializeUI(this.state);
        }

        // Start menu music (check if already playing globally)
        if (!this.sound.get('menu-music')) {
            this.menuMusic = this.sound.add('menu-music', { volume: 0.6, loop: true });
            this.menuMusic.play();
        } else {
            this.menuMusic = this.sound.get('menu-music');
        }
    }

    private initApi() {
        this.buttons.forEach((b) => b.destroy());
        this.topBar = new TopBar(this, true, this.api, this.state);
        this.subscription = this.api.state$.subscribe((state) => this.onStateChange(state));
    }

    /**
     * Initialize UI without scene status checks
     * Used by create() when scene status is CREATING
     */
    private updateDelegationButton(state: Game2DerivedState) {
        if (this.delegationButton) {
            this.delegationButton.destroy();
            this.delegationButton = undefined;
        }
        if (state.player !== undefined) {
            this.delegationButton = makeWalletDelegationButton(
                this,
                GAME_WIDTH - 60,
                TOP_BAR_OFFSET,
                this.api,
                state.myDelegatedAddress != null,
                state.playerId,
            );
        }
    }

    private initializeUI(state: Game2DerivedState) {
        // Destroy existing buttons and create new ones
        this.buttons.forEach((b) => b.destroy());
        this.buttons = [];
        this.updateDelegationButton(state);

        if (state.player !== undefined) {
            // Main menu buttons
            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.25, 280, 80, 'New Battle', 14, () => {
                this.scene.remove('BiomeSelectMenu');
                this.scene.add('BiomeSelectMenu', new BiomeSelectMenu(this.api!, false, state));
                this.scene.start('BiomeSelectMenu');
            }, 'Fight random enemies to earn gold and new spirits'));

            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.45, 280, 80, `Quests (${state.quests.size})`, 14, () => {
                this.scene.remove('QuestsMenu');
                this.scene.add('QuestsMenu', new QuestsMenu(this.api!, state));
                this.scene.start('QuestsMenu');
            }, 'Send spirits on timed missions, then fight a boss for big rewards'));

            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.65, 280, 80, 'Shop', 14, () => {
                this.scene.remove('ShopMenu');
                this.scene.add('ShopMenu', new ShopMenu(this.api!, state));
                this.scene.start('ShopMenu');
            }, 'Sell unwanted spirits or upgrade your favorites'));
        } else {
            // Register button
            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 400, 100, 'Register New Player', 14, () => {
                logger.gameState.info('Registering new player...');
                txSpinner.show("Generating Proof");
                this.input.enabled = false;
                this.registering = true;

                this.api!.register_new_player().catch((e) => {
                    logger.network.error(`Error registering new player: ${e}`);
                    txSpinner.hide();
                    this.input.enabled = true;
                    this.registering = false;

                    if (!this.scene.get('NetworkError')) {
                        this.scene.add('NetworkError', new NetworkError());
                    }
                    const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
                    networkErrorScene.setErrorMessage('Error registering player. Please try again.');
                    this.scene.launch('NetworkError');
                });
            }));
        }
    }

    private onStateChange(state: Game2DerivedState) {
        this.state = state;

        // Guard: Check if scene has been destroyed
        if (this.isDestroyed) {
            return;
        }

        // Guard: Check if scene is still valid and active before processing state changes
        // Store settings in variable to avoid TOCTOU race condition
        const sceneSettings = this.scene?.settings;
        if (!this.scene || !sceneSettings) {
            return;
        }

        // If MainMenu is not the active scene (but allow paused scenes for registration flow)
        // This prevents interference with other scenes like ActiveBattle
        const sceneStatus = sceneSettings.status;
        if (sceneStatus !== Phaser.Scenes.RUNNING && sceneStatus !== Phaser.Scenes.PAUSED) {
            return;
        }

        // Destroy and recreate buttons with updated state
        this.buttons.forEach((b) => b.destroy());
        this.updateDelegationButton(state);

        if (state.player !== undefined) {
            // Registration just completed — hide spinner if it was showing
            if (this.registering) {
                logger.gameState.info('Registered new player');
                txSpinner.hide();
                this.input.enabled = true;
                this.registering = false;
            }

            // Main menu buttons in vertical column with proper spacing
            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.25, 280, 80, 'New Battle', 14, () => {
                this.scene.remove('BiomeSelectMenu');
                this.scene.add('BiomeSelectMenu', new BiomeSelectMenu(this.api!, false, state));
                this.scene.start('BiomeSelectMenu');
            }, 'Fight random enemies to earn gold and new spirits'));

            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.45, 280, 80, `Quests (${state.quests.size})`, 14, () => {
                this.scene.remove('QuestsMenu');
                this.scene.add('QuestsMenu', new QuestsMenu(this.api!, state));
                this.scene.start('QuestsMenu');
            }, 'Send spirits on timed missions, then fight a boss for big rewards'));

            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.65, 280, 80, 'Shop', 14, () => {
                this.scene.remove('ShopMenu');
                this.scene.add('ShopMenu', new ShopMenu(this.api!, state));
                this.scene.start('ShopMenu');
            }, 'Sell unwanted spirits or upgrade your favorites'));
        } else {
            // We haven't registered a player yet, so show the register button
            this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 400, 100, 'Register New Player', 14, () => {
                logger.gameState.info('Registering new player...');
                txSpinner.show("Generating Proof");
                this.input.enabled = false;
                this.registering = true;

                this.api!.register_new_player().catch((e) => {
                    logger.network.error(`Error registering new player: ${e}`);
                    txSpinner.hide();
                    this.input.enabled = true;
                    this.registering = false;

                    // Show network error overlay
                    if (!this.scene.get('NetworkError')) {
                        this.scene.add('NetworkError', new NetworkError());
                    }
                    const networkErrorScene = this.scene.get('NetworkError') as NetworkError;
                    networkErrorScene.setErrorMessage('Error registering player. Please try again.');
                    this.scene.launch('NetworkError');
                });
            }));
        }
    }

    /**
     * Cleanup method to unsubscribe from state updates
     * Call this before removing the MainMenu scene to prevent stale state updates
     */
    public shutdown() {
        // Mark scene as destroyed to prevent any further state updates from processing
        this.isDestroyed = true;

        // Unsubscribe from state updates
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = undefined;
        }

        // Clean up delegation button
        if (this.delegationButton) {
            this.delegationButton.destroy();
            this.delegationButton = undefined;
        }
    }

}