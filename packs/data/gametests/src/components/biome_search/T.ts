import { world, system } from "@minecraft/server";
import { UI } from "../ui_queue/UI.js"; // Importação mantida conforme o seu ambiente[span_6](start_span)[span_6](end_span)

world.afterEvents.playerSpawn.subscribe(() => {
  let players = world.getAllPlayers();
  for (const player of players) {
    let Saved = player.getDynamicProperty("saved_biome");
    let On = player.getDynamicProperty("biome_find_on") ?? false;
    if (On) {
      system.run(() => {
        // Obtém a instância da fila e envia o comando de texto exato para a UI
        const uiData = UI.getUI(player);
        uiData.addUI("biome_find", `biome_find:${Saved}`);
      });
    }
  }
});

system.runInterval(() => {
  const players = world.getAllPlayers();
  for (const player of players) {
    const isLearningActive = player.getDynamicProperty("biome_hud_learning") ?? true;

    if (!isLearningActive) {
      continue;
    }

    try {
      const pos = player.location;
      const dimension = player.dimension;
      let Old = player.getDynamicProperty("old_biome_find");

      // Detecção do bioma baseada nas coordenadas do jogador
      const biome = dimension.getBiome(pos);
      const rawId = biome.id;

      // Formata a string de forma legível (ex: minecraft:dark_forest -> Dark Forest)
      const formattedBiome = rawId
        .replace("minecraft:", "")
        .replace("bs:", "")
        .split("_")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      if (rawId != Old) {
        player.setDynamicProperty("old_biome_find", rawId);
        player.setDynamicProperty("saved_biome", formattedBiome);

        // Enviando para a fila de UI de forma segura sem alterar a string de comunicação
        const uiData = UI.getUI(player);
        uiData.addUI("biome_find", `biome_find:${formattedBiome}`);

        player.setDynamicProperty("biome_find_on", true);
      }
    } catch (e) {
      player.onScreenDisplay.setActionBar("§4error");
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

    player.sendMessage(`§eHUD : ${newState ? "§a activated" : "§c deactivated"}`);

    if (!newState) {
      player.onScreenDisplay.setActionBar("");
    }
  }
});
*/
