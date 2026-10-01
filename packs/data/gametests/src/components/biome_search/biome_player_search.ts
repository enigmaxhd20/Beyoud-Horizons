import { world, system } from "@minecraft/server";
import { UI } from "../ui_queue/UI.js";
//import { WailaSettingsManager, WailaInstance, Waila_reanalyze } from "../waila/main.js"

world.afterEvents.playerSpawn.subscribe(() => {
  let players = world.getAllPlayers();
  for (const player of players) {
    let isLearnigActive = player.getDynamicProperty("biome_hud_learning") ?? true
    if (!isLearnigActive) continue;
    let T = player.getDynamicProperty("off_biome_find_p") ?? false
    if (!T) {
      player.setDynamicProperty("off_biomr_find_p", true)
    }
    let Saved = player.getDynamicProperty("saved_biome_find");
    let On = player.getDynamicProperty("biome_find_on") ?? false;
    if (On) {
      system.run(() => {
        const uiData = UI.getUI(player);
        uiData.addUI("bs:", `biome_find:${Saved}`);
      });
    }
  }
});

system.runInterval(() => {
  const players = world.getAllPlayers();
  for (const player of players) {
    let Ts = player.getDynamicProperty("off_biome_find_p") ?? false
    const isLearningActive = player.getDynamicProperty("biome_hud_learning") ?? true;

    if (!isLearningActive) {
      let T = player.getDynamicProperty("off_biome_find_p") ?? true
      if (T) {
        let UiData = UI.getUI(player)
        UiData.addUI("bs:", `biome_find:`)
        player.setDynamicProperty("off_biome_find_p", false)
        player.setDynamicProperty("old_biome_find", undefined)
      }
      continue;
    }
    if (!Ts) {
      player.setDynamicProperty("off_biome_find_p", true)
    }

    try {
      const pos = player.location;
      const dimension = player.dimension;

      let currentDimensionId = dimension.id;
      let lastDimension = player.getDynamicProperty("biome_find_last_dimension");

      if (lastDimension !== currentDimensionId) {
        player.setDynamicProperty("biome_find_last_dimension", currentDimensionId);
        player.setDynamicProperty("old_biome_find", "");
      }
      let Old = player.getDynamicProperty("old_biome_find");
      const biome = dimension.getBiome(pos);
      const rawId = biome.id;

      const formattedBiome = rawId
        .replace("minecraft:", "")
        .replace("bs:", "")
        .split("_")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      if (rawId != Old) {
        player.setDynamicProperty("old_biome_find", rawId);
        player.setDynamicProperty("saved_biome_find", formattedBiome);
        let IsActive = player.getDynamicProperty("bs:waila_show") ?? true
        const uiData = UI.getUI(player);
        uiData.addUI("bs:", `biome_find:${formattedBiome}`);
        player.setDynamicProperty("biome_find_on", true);
        if (IsActive) {
          var First_load = player.getDynamicProperty("biome_find_first_load") ?? false
          if (First_load) {
            system.runTimeout(() => {
            }, 10)
          }
        }
      }
    } catch (e) {
      let UiData = UI.getUI(player)
      UiData.addUI("bs:", `biome_find:loading..`)
      player.setDynamicProperty("old_biome_find", undefined)
    }
  }
}, 10);
                                                                                                                                                                                                                                                                                                               // Escuta a chamada do evento para alternar a HUD (ativar/desativar modo de aprendizagem)
/*system.afterEvents.scriptEventReceive.subscribe((event) => {
if (event.id === "custom:toggle_biome") {
const player = event.initiator;
 if (!player) return;

     const currentState = player.getDynamicProperty("biome_hud_learning") ?? true;
         const newState = !currentState;

             player.sendMessage(`§eHUD: ${ newState ? "§a activated" : "§c deactivated" } `);

                 if (!newState) {
                       player.onScreenDisplay.setActionBar("");
                           }
                             }
                             });
*/
