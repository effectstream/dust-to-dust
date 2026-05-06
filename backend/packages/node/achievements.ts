// ---------------------------------------------------------------------------
// achievements.ts — Achievement definitions and database seed migration
// ---------------------------------------------------------------------------

export interface AchievementDefinition {
  name: string;
  displayName: string;
  description: string;
  category: string;
  isActive: boolean;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // --- Quest Achievements ---
  // Quest Completion
  { name: "first_quest", displayName: "First Quest", description: "Complete your first quest and defeat a boss", category: "quest", isActive: true },
  { name: "novice_explorer", displayName: "Novice Explorer", description: "Complete 5 quests", category: "quest", isActive: true },
  { name: "seasoned_adventurer", displayName: "Seasoned Adventurer", description: "Complete 10 quests", category: "quest", isActive: true },
  { name: "experienced_adventurer", displayName: "Experienced Adventurer", description: "Complete 15 quests", category: "quest", isActive: true },
  { name: "skilled_explorer", displayName: "Skilled Explorer", description: "Complete 20 quests", category: "quest", isActive: true },
  { name: "expert_explorer", displayName: "Expert Explorer", description: "Complete 25 quests", category: "quest", isActive: true },
  { name: "veteran_explorer", displayName: "Veteran Explorer", description: "Complete 30 quests", category: "quest", isActive: true },
  { name: "quest_master", displayName: "Quest Master", description: "Complete 50 quests", category: "quest", isActive: true },
  { name: "legendary_explorer", displayName: "Legendary Explorer", description: "Complete 100 quests", category: "quest", isActive: true },
  // Biome Mastery
  { name: "grasslands_conqueror", displayName: "Grasslands Conqueror", description: "Defeat the Grasslands boss at all 3 difficulties", category: "quest", isActive: true },
  { name: "desert_conqueror", displayName: "Desert Conqueror", description: "Defeat the Scorched Desert boss at all 3 difficulties", category: "quest", isActive: true },
  { name: "tundra_conqueror", displayName: "Tundra Conqueror", description: "Defeat the Frozen Tundra boss at all 3 difficulties", category: "quest", isActive: true },
  { name: "cave_conqueror", displayName: "Cave Conqueror", description: "Defeat the Goblin Caves boss at all 3 difficulties", category: "quest", isActive: true },
  { name: "world_conqueror", displayName: "World Conqueror", description: "Defeat all bosses in every biome at every difficulty", category: "quest", isActive: true },
  // Difficulty Progression
  { name: "frontier_scout", displayName: "Frontier Scout", description: "Defeat any Frontier (difficulty 1) boss", category: "quest", isActive: true },
  { name: "interior_breacher", displayName: "Interior Breacher", description: "Defeat any Interior (difficulty 2) boss", category: "quest", isActive: true },
  { name: "stronghold_crusher", displayName: "Stronghold Crusher", description: "Defeat any Stronghold (difficulty 3) boss", category: "quest", isActive: true },
  // Boss Combat
  { name: "flawless_victory", displayName: "Flawless Victory", description: "Defeat a boss without taking any damage", category: "quest", isActive: true },
  { name: "close_call", displayName: "Close Call", description: "Defeat a boss with 90+ damage taken", category: "quest", isActive: true },
  { name: "no_retreat", displayName: "No Retreat", description: "Defeat 10 bosses in a row without retreating", category: "quest", isActive: true },
  // Multi-Quest Management
  { name: "multitasker", displayName: "Multitasker", description: "Have 3 quests active simultaneously (max capacity)", category: "quest", isActive: true },
  // Losses and Resilience
  { name: "fallen_hero", displayName: "Fallen Hero", description: "Lose a boss fight (and your abilities with it)", category: "quest", isActive: true },
  { name: "persistence", displayName: "Persistence", description: "Lose a boss fight, then defeat the same boss later", category: "quest", isActive: true },
  { name: "tactical_retreat", displayName: "Tactical Retreat", description: "Retreat from a boss fight to save your abilities", category: "quest", isActive: true },

  // --- Battle Achievements ---
  // Battle Milestones
  { name: "first_blood", displayName: "First Blood", description: "Win your first battle", category: "battle", isActive: true },
  { name: "battle_hardened", displayName: "Battle Hardened", description: "Win 50 battles", category: "battle", isActive: true },
  { name: "warmonger", displayName: "Warmonger", description: "Win 100 battles", category: "battle", isActive: true },
  { name: "grizzled_veteran", displayName: "Grizzled Veteran", description: "Win 250 battles", category: "battle", isActive: true },
  // Battle Feats
  { name: "speed_demon", displayName: "Speed Demon", description: "Win a battle in a single round", category: "battle", isActive: true },
  { name: "marathon_fight", displayName: "Marathon Fight", description: "Win a battle that lasted 10+ rounds", category: "battle", isActive: true },
  { name: "untouchable", displayName: "Untouchable", description: "Win a 3-enemy battle taking 0 damage", category: "battle", isActive: true },
  { name: "survivor", displayName: "Survivor", description: "Win a battle with 95+ damage taken", category: "battle", isActive: true },
  // Combat Totals
  { name: "slayer", displayName: "Slayer", description: "Defeat 100 enemies total", category: "battle", isActive: true },
  { name: "annihilator", displayName: "Annihilator", description: "Defeat 500 enemies total", category: "battle", isActive: true },
  { name: "round_veteran", displayName: "Round Veteran", description: "Play 500 combat rounds", category: "battle", isActive: true },

  // --- Spirit & Deck Achievements ---
  // Spirit Collection
  { name: "spirit_collector", displayName: "Spirit Collector", description: "Own 25 spirits", category: "spirit_deck", isActive: true },
  { name: "spirit_hoarder", displayName: "Spirit Hoarder", description: "Own 50 spirits", category: "spirit_deck", isActive: true },
  // Deck Building
  { name: "mono_fire", displayName: "Mono Fire", description: "Win a battle with only fire-attack spirits in your loadout", category: "spirit_deck", isActive: true },
  { name: "mono_ice", displayName: "Mono Ice", description: "Win a battle with only ice-attack spirits in your loadout", category: "spirit_deck", isActive: true },
  { name: "glass_cannon", displayName: "Glass Cannon", description: "Win a battle with no block or heal spirits in your loadout", category: "spirit_deck", isActive: true },
  { name: "mono_physical", displayName: "Mono Physical", description: "Win a battle with only physical-attack spirits in your loadout", category: "spirit_deck", isActive: true },

  // --- Upgrade Achievements ---
  // Upgrade Milestones
  { name: "apprentice_smith", displayName: "Apprentice Smith", description: "Upgrade a spirit for the first time", category: "upgrade", isActive: true },
  { name: "journeyman_smith", displayName: "Journeyman Smith", description: "Upgrade 10 spirits", category: "upgrade", isActive: true },
  { name: "master_smith", displayName: "Master Smith", description: "Upgrade 25 spirits", category: "upgrade", isActive: true },
  // Upgrade by Type
  { name: "pyro_forger", displayName: "Pyro Forger", description: "Upgrade 10 fire-attack spirits", category: "upgrade", isActive: true },
  { name: "cryo_forger", displayName: "Cryo Forger", description: "Upgrade 10 ice-attack spirits", category: "upgrade", isActive: true },
  { name: "weapons_forger", displayName: "Weapons Forger", description: "Upgrade 10 physical-attack spirits", category: "upgrade", isActive: true },
  { name: "shield_forger", displayName: "Shield Forger", description: "Upgrade 10 block spirits", category: "upgrade", isActive: true },
  // Upgrade Quality
  { name: "rising_star", displayName: "Rising Star", description: "Own a spirit at 2 stars", category: "upgrade", isActive: true },
  { name: "perfection", displayName: "Perfection", description: "Own a spirit at 3 stars (max)", category: "upgrade", isActive: true },
  { name: "master_forger", displayName: "Master Forger", description: "Own 3 fully upgraded (3-star) spirits simultaneously", category: "upgrade", isActive: true },
  { name: "max_power", displayName: "Max Power", description: "Own a 3-star spirit of every element (Fire, Ice, Physical)", category: "upgrade", isActive: true },

  // --- Economy Achievements ---
  // Gold Milestones
  { name: "first_coin", displayName: "First Coin", description: "Earn your first gold", category: "economy", isActive: true },
  { name: "treasure_hunter", displayName: "Treasure Hunter", description: "Earn 500 gold total", category: "economy", isActive: true },
  { name: "golden_hoard", displayName: "Golden Hoard", description: "Earn 2000 gold total", category: "economy", isActive: true },
  { name: "dragons_vault", displayName: "Dragon's Vault", description: "Earn 10000 gold total", category: "economy", isActive: true },
  // Spending
  { name: "big_spender", displayName: "Big Spender", description: "Spend 1000 gold total", category: "economy", isActive: true },
  // Selling
  { name: "merchant", displayName: "Merchant", description: "Sell 10 spirits", category: "economy", isActive: true },
  { name: "spirit_trader", displayName: "Spirit Trader", description: "Sell 50 spirits", category: "economy", isActive: true },
  // Selling by Type
  { name: "fire_sale", displayName: "Fire Sale", description: "Sell 15 fire-attack spirits", category: "economy", isActive: true },
  { name: "cold_surplus", displayName: "Cold Surplus", description: "Sell 15 ice-attack spirits", category: "economy", isActive: true },
  { name: "disarmed", displayName: "Disarmed", description: "Sell 15 physical-attack spirits", category: "economy", isActive: true },
  { name: "shields_down", displayName: "Shields Down", description: "Sell 15 block spirits", category: "economy", isActive: true },

  // --- Combat Mastery Achievements ---
  // Elemental Mastery
  { name: "balanced_fighter", displayName: "Balanced Fighter", description: "Win a battle with all 3 attack elements in your loadout (Physical, Fire, and Ice)", category: "combat_mastery", isActive: true },
  { name: "elemental_focus", displayName: "Elemental Focus", description: "Win a battle where every attack ability in your loadout shares the same element", category: "combat_mastery", isActive: true },
  { name: "full_spectrum", displayName: "Full Spectrum", description: "Own an upgraded (1+ star) ability of every effect type", category: "combat_mastery", isActive: true },
  // Energy Synergy
  { name: "energy_specialist", displayName: "Energy Specialist", description: "Own 3+ abilities that generate the same energy color", category: "combat_mastery", isActive: true },
  { name: "overcharged", displayName: "Overcharged", description: "Win a battle with 3+ loadout abilities sharing the same energy color", category: "combat_mastery", isActive: true },
  // Damage Output
  { name: "damage_dealer", displayName: "Damage Dealer", description: "Deal 300+ total damage to enemies in a single battle", category: "combat_mastery", isActive: true },
  { name: "overwhelming_force", displayName: "Overwhelming Force", description: "Deal 600+ total damage to enemies in a single battle", category: "combat_mastery", isActive: true },
  { name: "devastator", displayName: "Devastator", description: "Deal 10000 total damage across all battles", category: "combat_mastery", isActive: true },
  // Loadout Mastery
  { name: "fortified", displayName: "Fortified", description: "Win a battle with 3+ block abilities in your loadout", category: "combat_mastery", isActive: true },
  { name: "aoe_arsenal", displayName: "AOE Arsenal", description: "Own 3+ abilities with AOE effects", category: "combat_mastery", isActive: true },
  { name: "power_surge", displayName: "Power Surge", description: "Win a battle with a fully upgraded (3-star) ability in your loadout", category: "combat_mastery", isActive: true },
];

// ---------------------------------------------------------------------------
// Migration: seed achievement definitions into the database
// ---------------------------------------------------------------------------

export async function seedAchievements(db: any): Promise<void> {
  if (ACHIEVEMENT_DEFINITIONS.length === 0) return;

  const placeholders = ACHIEVEMENT_DEFINITIONS
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(", ");
  const values = ACHIEVEMENT_DEFINITIONS.flatMap((a) => [
    a.name,
    a.displayName,
    a.description,
    a.category,
  ]);

  await db.query(
    `INSERT INTO d2d_achievements (name, display_name, description, category)
     VALUES ${placeholders}
     ON CONFLICT (name) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           description  = EXCLUDED.description,
           category     = EXCLUDED.category`,
    values,
  );

  console.log(`[achievements] Seeded ${ACHIEVEMENT_DEFINITIONS.length} achievement definitions`);
}
