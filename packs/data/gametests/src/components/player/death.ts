console.log("death.js loaded successfully");
import { world, system } from "@minecraft/server";
world.afterEvents.entityDie.subscribe((eventData) => {
  const entity = eventData.deadEntity;
  if (entity.typeId === "minecraft:player") {
    const player = entity as any;
    const colorLocation = player.getDynamicProperty("colorLocation") ?? "§5";
    const { x, y, z } = player.location;
    const locationPlayer = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
    const deathMessage = `${player.name ?? "Player"} has died! in :${colorLocation}${locationPlayer}`;
    try {
    var deathCount = (player.getDynamicProperty("deathCount") as number) ?? 0;
      deathCount++;
    } catch (error) {
      console.error("Error retrieving deathCount:", error);
      deathCount = 1; // Initialize to 1 if there's an error
    }
    player.setDynamicProperty("deathCount", deathCount);
    player.sendMessage?.(deathMessage);
  }
});