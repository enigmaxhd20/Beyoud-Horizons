import { world, Player } from "@minecraft/server";

export const DefaultSettings: Map<string, unknown> = new Map();

world.afterEvents.playerSpawn.subscribe((eventData) => {
  const player: Player = eventData.player;
  const initialSpawn: boolean = eventData.initialSpawn;
  const firstPlayerSetup = player.getDynamicProperty("first_p");

  if (initialSpawn) {
    if (firstPlayerSetup === false) {
      DefaultSettings.forEach((value, key) => {
        player.setDynamicProperty(key, value as string | number | boolean | undefined);
      });
      player.sendMessage("§e Default settings successfully defined.");
      player.setDynamicProperty("first_p", true);
    } else {
      player.sendMessage("bs.feedback.player.send.wellcomeBack");
    }
  }
});