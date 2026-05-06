# Contract

This is the game's Midnight contract. You should only modify `src/template.contract`. When running `npm run compact` it will execute the code generation script in `src/generate.js` which will take the contract template and insert the generated code in to `src/game2.contract`.

DO NOT MODIFY `src/game2.contract` MANUALLY.

Any time this is modified you will need to re-run `npm run compact` and `npm run build`. The `api` and `phaser` modules will need to be re-built as well.