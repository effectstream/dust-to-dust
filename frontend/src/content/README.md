# Content

Helper package that contains game content to be deployed in contract or mocked in the case the contract is being mocked out.

## How to add enemies?

### Content (here)

* (intial content): `content/src/register.ts`
* (post launch): TODO - need to update tools

### Phaser

* `phaser/src/animations/enemy.ts`: `SPRITE_SHEET_ENEMIES` + `ENEMY_FRAME_CONFIG`
* `phaser/src/battle/EnemyManager.ts`: `ENEMY_TEXTURES` or `BOSS_TEXTURES`
* `phaser/src/menus/main.ts`: `TestMenu.preload()`