/**
 * All frontend functionality related to Abilities (outside of battle?)
 */
import { Ability, Effect, EFFECT_TYPE } from "game2-contract";
import { fontStyle, logger } from "../main";
import { addScaledImage, scale } from "../utils/scaleImage";
import { Color, colorToNumber } from "../constants/colors";
import { BG_TYPE, makeWidgetBackground, WidgetBackground } from "./widget-background";
import { orbAuraIdleKey, spiritAuraIdleKey } from "../animations/spirit";

/// Adjusts contract-level damage numbers to a base/average amount (normal damage resistance)
export function contractDamageToBaseUI(amount: number | bigint): number {
    return Number(amount) * 2;
}

function addEffectIcons(container: Phaser.GameObjects.Container, effect: Effect, xOffset: number, yOffset: number, tint: Color): Phaser.GameObjects.GameObject[] {
    let uiComponents = [];
    if (effect.is_aoe) {
        uiComponents.push(addScaledImage(container.scene, xOffset + 20, yOffset - 6, 'aoe').setTint(colorToNumber(tint)));
    }
    switch (effect.effect_type) {
        case EFFECT_TYPE.attack_fire:
            uiComponents.push(addScaledImage(container.scene, xOffset + 20, yOffset, 'fire'));
            uiComponents.push(container.scene.add.text(xOffset - 2, yOffset - 6, contractDamageToBaseUI(effect.amount).toString(), fontStyle(8)).setOrigin(0.5, 0.5).setTint(colorToNumber(tint)));
            break;
        case EFFECT_TYPE.attack_ice:
            uiComponents.push(addScaledImage(container.scene, xOffset + 20, yOffset, 'ice'));
            uiComponents.push(container.scene.add.text(xOffset - 2, yOffset - 6, contractDamageToBaseUI(effect.amount).toString(), fontStyle(8)).setOrigin(0.5, 0.5).setTint(colorToNumber(tint)));
            break;
        case EFFECT_TYPE.attack_phys:
            uiComponents.push(addScaledImage(container.scene, xOffset + 20, yOffset, 'physical'));
            uiComponents.push(container.scene.add.text(xOffset - 2, yOffset - 6, contractDamageToBaseUI(effect.amount).toString(), fontStyle(8)).setOrigin(0.5, 0.5).setTint(colorToNumber(tint)));
            break;
        case EFFECT_TYPE.block:
            uiComponents.push(addScaledImage(container.scene, xOffset + 20, yOffset, 'block'));
            uiComponents.push(container.scene.add.text(xOffset - 2, yOffset - 6, effect.amount.toString(), fontStyle(8)).setOrigin(0.5, 0.5).setTint(colorToNumber(tint)));
            break;
    }
    uiComponents.forEach((comp) => container.add(comp));
    return uiComponents;
}

export class AbilityWidget extends Phaser.GameObjects.Container {
    bg: WidgetBackground & Phaser.GameObjects.GameObject;
    ability: Ability;
    baseEffectUI: Phaser.GameObjects.GameObject[];
    energyEffectUI: Phaser.GameObjects.GameObject[][];

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        ability: Ability,
     ) {
        super(scene, x, y);
        const w = 90;
        const h = 128;
        this.setSize(w, h);
        this.bg = makeWidgetBackground(scene, 0, 0, w, h, BG_TYPE.Parchment);
        if (ability.generate_color.is_some) {
            this.bg.setTint(colorToNumber(energyTypeToColor(Number(ability.generate_color.value))));
        }
        this.ability = ability;
        this.baseEffectUI = [];
        this.energyEffectUI = [[], [], []];

        this.add(this.bg);

        scene.add.existing(this);

        this.bg.tweenIn({
            duration: 1000,
            onComplete: () => {
                if (ability.effect.is_some) {
                    this.baseEffectUI = addEffectIcons(this, ability.effect.value, -6, -40, this.bg.textColor);
                }
                for (let i = 0; i < ability.on_energy.length; ++i) {
                    if (ability.on_energy[i].is_some) {
                        const energyY = 32 * i - 16;
                        this.add(addScaledImage(scene, -28, energyY, `energy-icon`).setTint(colorToNumber(energyTypeToColor(i))));
                        this.add(addScaledImage(scene, -15, energyY, 'arrow').setTint(colorToNumber(Color.Brown)));
                        this.energyEffectUI[i] = addEffectIcons(this, ability.on_energy[i].value, 7, energyY, this.bg.textColor);
                    }
                }
            },
        });
    }
}

const iToRad = 2 * Math.PI / 3;

export class SpiritWidget extends Phaser.GameObjects.Container {
    ability: Ability;
    aura: Phaser.GameObjects.Sprite | undefined;
    spirit: Phaser.GameObjects.Sprite;
    orbs: (OrbWidget | null)[];
    tick: number;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        ability: Ability,
     ) {
        super(scene, x, y);

        this.setSize(64, 64);

        this.ability = ability;

        if (ability.generate_color.is_some) {
            this.aura = scale(scene.add.sprite(0, 0, 'spirit-aura').setTint(colorToNumber(energyTypeToColor(Number(ability.generate_color.value)))));
            this.add(this.aura);
            this.aura.anims.play(spiritAuraIdleKey);
        }

        // TODO: what if this is null? we currently never have that so maybe we should make it `Effect` not `Maybe<Effect>`, or have a neutral no-armed spirit
        this.spirit = scale(scene.add.sprite(0, 0, `spirit-${effectTypeFileAffix(ability.effect.value.effect_type)}`));
        this.add(this.spirit);
        this.spirit.anims.play(`spirit-${effectTypeFileAffix(ability.effect.value.effect_type)}`);

        this.tick = Math.random() * 2 * Math.PI;

        this.orbs = [0, 1, 2].map((i) => {
            if (ability.on_energy[i].is_some) {
                const trigger = ability.on_energy[i].value;
                const orb = new OrbWidget(scene, this.orbX(i), this.orbY(i), trigger, i);
                this.add(orb);
                return orb;
            }
            return null;
        });

        scene.add.existing(this);
    }

    preUpdate() {
        this.orbs.forEach((orb, i) => orb?.setPosition(this.orbX(i), this.orbY(i)));
        this.tick += 0.015;
    }

    // TODO: potentially replace with more interesting elliptical orbits that go in front/behind the spirit
    private orbX(i: number): number {
        return 32 * Math.cos(i * iToRad + this.tick);
    }

    private orbY(i: number): number {
        return -32 * Math.sin(i * iToRad + this.tick);
    }
}

export enum ENERGY_TYPE {
    cyan = 0,
    yellow = 1,
    magenta = 2,
}

export function energyTypeToColor(energyType: ENERGY_TYPE): Color {
    switch (energyType) {
        case ENERGY_TYPE.cyan:
            return Color.DarkGreen;
        case ENERGY_TYPE.yellow:
            return Color.Olive;
        case ENERGY_TYPE.magenta:
            return Color.Violet;
    }
}

export function effectTypeFileAffix(effectType: EFFECT_TYPE): string {
    switch (effectType) {
        case EFFECT_TYPE.attack_fire:
            return 'atk-fire';
        case EFFECT_TYPE.attack_ice:
            return 'atk-ice';
        case EFFECT_TYPE.attack_phys:
            return 'atk-phys';
        case EFFECT_TYPE.block:
            return 'def';
    }
}

function effectTypeName(effectType: EFFECT_TYPE): string {
    switch (effectType) {
        case EFFECT_TYPE.attack_fire: return 'Fire Dmg';
        case EFFECT_TYPE.attack_ice: return 'Ice Dmg';
        case EFFECT_TYPE.attack_phys: return 'Physical Dmg';
        case EFFECT_TYPE.block: return 'Block';
    }
}

function energyTypeName(energyType: number): string {
    switch (energyType) {
        case ENERGY_TYPE.cyan: return 'Cyan';
        case ENERGY_TYPE.yellow: return 'Yellow';
        case ENERGY_TYPE.magenta: return 'Magenta';
        default: return 'Unknown';
    }
}

function describeEffect(effect: Effect): string {
    const amount = effect.effect_type === EFFECT_TYPE.block
        ? Number(effect.amount)
        : contractDamageToBaseUI(effect.amount);
    const aoe = effect.is_aoe ? ' (All Enemies)' : '';
    return `${amount} ${effectTypeName(effect.effect_type)}${aoe}`;
}

export function describeAbility(ability: Ability): string {
    const lines: string[] = [];

    // Line 1: Spirit type + energy color
    const typeName = ability.effect.is_some
        ? effectTypeName(ability.effect.value.effect_type).replace(' Dmg', '')
        : 'Neutral';
    const colorName = ability.generate_color.is_some
        ? `Generates ${energyTypeName(Number(ability.generate_color.value))}`
        : 'No Energy';
    lines.push(`${typeName} Spirit (${colorName})`);

    // Line 2: Base effect
    if (ability.effect.is_some) {
        lines.push(`Base: ${describeEffect(ability.effect.value)}`);
    }

    // Lines 3-5: Energy triggers
    for (let i = 0; i < ability.on_energy.length; ++i) {
        if (ability.on_energy[i].is_some) {
            lines.push(`On ${energyTypeName(i)}: ${describeEffect(ability.on_energy[i].value)}`);
        }
    }

    // Upgrade level
    const level = Number(ability.upgrade_level);
    if (level > 0) {
        lines.push(`Upgrade: +${level}`);
    }

    return lines.join('\n');
}

class OrbWidget extends Phaser.GameObjects.Container {
    aura: Phaser.GameObjects.Sprite;
    orb: Phaser.GameObjects.Image;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        effect: Effect,
        trigger: ENERGY_TYPE,
     ) {
        super(scene, x, y);

        this.setSize(16, 16);
        
        this.aura = scale(scene.add.sprite(0, 0, 'orb-aura').setTint(colorToNumber(energyTypeToColor(trigger))));
        this.add(this.aura);
        this.aura.anims.play(orbAuraIdleKey);

        this.orb = scale(scene.add.image(0, 0, `orb-${effectTypeFileAffix(effect.effect_type)}`));
        this.add(this.orb);

        scene.add.existing(this);
     }
}