import { world, system, ItemStack } from "@minecraft/server";

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "bsduck_caught_fish") {
    const duck = event.sourceEntity;
    if (!duck) return;

    const dim = duck.dimension;
    const headLocation = duck.getHeadLocation();
    const viewDir = duck.getViewDirection();

    // Calcula posição de saída (bico)
    const spawnPos = {
      x: headLocation.x + viewDir.x * 0.5,
      y: headLocation.y + viewDir.y * 0.5,
      z: headLocation.z + viewDir.z * 0.5
    };

    try {
      const item = new ItemStack("minecraft:cod", 1);
      const itemEnt = dim.spawnItem(item, spawnPos);
      // Dá o impulso de "cuspida"
      itemEnt.applyImpulse({ x: viewDir.x * 0.2, y: 0.15, z: viewDir.z * 0.2 });
    } catch (e) {
      console.warn("Erro ao pescar: " + e);
    }
  }
});
