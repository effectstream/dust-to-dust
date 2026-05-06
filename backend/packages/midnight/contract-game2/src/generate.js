/**
 * Code generation for the game's contract.
 * 
 * Many parts of combat code would be incredibly tedious and error-prone to hand-write.
 * Instead of several 3000 character lines with only different variable names or array indices
 * we generate that code here and replace the placeholder strings in the contract.
 */

import fs from 'fs';

function codegen_placeholders() {
    let templateCode = fs.readFileSync('src/template.compact').toString();
    const replaced = templateCode
        .replaceAll('INSERT_PLAYER_DAMAGE_CODE_HERE', gen_player_dmg())
        .replaceAll('INSERT_PLAYER_BLOCK_CODE_HERE', gen_player_block())
        .replaceAll('INSERT_ENEMY_DAMAGE_CODE_HERE', gen_enemy_dmg())
        .replaceAll('INSERT_ENEMY_BLOCK_CODE_HERE', gen_enemy_block())
        .replaceAll('INSERT_ENEMY_HEAL_CODE_HERE', gen_enemy_heal())
        .replaceAll('INSERT_DECK_INDEX_CALCULATION_CODE_HERE', gen_deck_index_calculation())
        .replaceAll('INSERT_DECK_INDEX_BATTLE_STATE_INIT_CODE_HERE', gen_deck_index_eval());
    fs.writeFileSync('src/game2.compact', `// AUTO-GENERATED - **DO NOT MODIFY**\n// PLEASE CHANGE template.compact INSTEAD!\n\n${replaced}`);
}



const DECK_SIZE = 7;
const HAND_SIZE = 3;

const abilities = new Array(HAND_SIZE).fill(0).map((_, i) => i);
const colors = [0, 1, 2];
const max_enemies = [0, 1, 2];
const decK_increments = [1, 2, 3, 4];



// player

const gen_player_dmg = () => max_enemies.map((enemy) => `const damage_to_enemy_${enemy} = (${gen_base_player_dmg(enemy)} + ${gen_energy_player_dmg(enemy)}) as Uint<32>;`).join('\n    ');

const gen_base_player_dmg = (enemy) => abilities.map((a) => `((abilities[${a}].effect.is_some && (abilities[${a}].effect.value.is_aoe || ability_targets[${a}] == ${enemy})) as Uint<1>) * effect_damage(abilities[${a}].effect.value, battle.enemies.stats[${enemy}])`).join(' + ');
const gen_energy_player_dmg = (enemy) => abilities.map((a) => colors.map((c) => `((abilities[${a}].on_energy[${c}].is_some && ${generates_color(a, c)} && (abilities[${a}].on_energy[${c}].value.is_aoe || ability_targets[${a}] == ${enemy})) as Uint<1>) * effect_damage(abilities[${a}].on_energy[${c}].value, battle.enemies.stats[${enemy}])`).join(' + ')).join(' + ');

const gen_player_block = () => `const player_block = (${gen_base_player_block()} + ${gen_energy_player_block()}) as Uint<32>;`;

const gen_base_player_block = () => abilities.map((a) => `(((abilities[${a}].effect.is_some && abilities[${a}].effect.value.effect_type == EFFECT_TYPE.block) as Uint<1>) * abilities[${a}].effect.value.amount)`).join(' + ');
const gen_energy_player_block = () => abilities.map((a) => colors.map((c) => `(((abilities[${a}].on_energy[${c}].is_some && abilities[${a}].on_energy[${c}].value.effect_type == EFFECT_TYPE.block && ${generates_color(a, c)}) as Uint<1>) * abilities[${a}].on_energy[${c}].value.amount)`).join(' + ')).join(' + ');

const generates_color = (a, c) => `(${abilities.filter((a2) => a != a2).map((a2) => `(abilities[${a2}].generate_color.is_some && abilities[${a2}].generate_color.value == ${c})`).join(' || ')})`;



// enemy

const gen_enemy_dmg = () => `const damage_to_player = (${max_enemies.map((enemy) => `(enemy_moves[${enemy}].attack * ((new_damage_to_enemy_${enemy} < battle.enemies.stats[${enemy}].hp) as Uint<1>))`).join(' + ')}) as Uint<32>;`;

const gen_enemy_block = () => max_enemies.map((enemy) => `const enemy_block_${enemy} = (enemy_moves[${enemy}].block_self + ${max_enemies.filter(e => e != enemy).map(e => `enemy_moves[${e}].block_allies * ((old_state.damage_to_enemy_${e} < battle.enemies.stats[${e}].hp) as Uint<1>)`).join(' + ')}) as Uint<32>;`).join('\n    ');

const gen_enemy_heal = () => max_enemies.map((enemy) => `const enemy_heal_${enemy} = (((new_damage_to_enemy_${enemy} < battle.enemies.stats[${enemy}].hp) as Uint<1>) * (enemy_moves[${enemy}].heal_self + ${max_enemies.filter(e => e != enemy).map(e => `enemy_moves[${e}].heal_allies * ((new_damage_to_enemy_${e} < battle.enemies.stats[${e}].hp) as Uint<1>)`).join(' + ')})) as Uint<32>;`).join('\n    ');

// deck indices

const gen_deck_index_calculation = () => abilities.map((a) => {
    let code = '';
    const line = (s) => {
        code += `\n    ${s}`;
    };
    const attempts = (n) => n == 1 ? 1 : attempts(n - 1) + n;

    line(`const new_deck_${a}${a == 0 ? '' : '_attempt_0'} = add_mod(old_state.deck_indices[${a}], ${decK_increments[a]}, ${DECK_SIZE});`);
    let attempt = 1;
    // i = other ability
    // j = cycle through previous other abilities in case attempt i causes conflict with previous index j
    for (let i = 0; i < a; ++i) {
        line(`const new_deck_${a}${attempt == attempts(a) ? '' : `_attempt_${attempt}`} = new_deck_${a}_attempt_${attempt - 1} == new_deck_${i} ? add_mod(new_deck_${a}_attempt_${attempt - 1}, 1, 7) : new_deck_${a}_attempt_${attempt - 1};`);
        ++attempt;
        for (let j = 0; j < i; ++j) {
            line(`const new_deck_${a}${attempt == attempts(a) ? '' : `_attempt_${attempt}`} = new_deck_${a}_attempt_${attempt - 1} == new_deck_${j} ? add_mod(new_deck_${a}_attempt_${attempt - 1}, 1, 7) : new_deck_${a}_attempt_${attempt - 1};`);
            ++attempt;
        }
    }

    // 0,1,0
    // next:
    // 0,1,0,2,0,1
    // then:
    // 0,1,0,2,0,1,3,0,1,2

    return code;
}).join('\n    ');

const gen_deck_index_eval = () => `[${abilities.map((a) => `new_deck_${a}`).join()}]`;



codegen_placeholders();