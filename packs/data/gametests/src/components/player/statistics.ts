import { world, system, Player, Entity, EntityComponentTypes, EntityComponent, EntityHealthComponent } from "@minecraft/server";

export interface PlayerStatistics {
  deathCount: number;
  locationPlayer: string;
  lifeCount: number;
}
export class playerStatistics {
  static getPlayerStatistics(player: Player): PlayerStatistics {
    const deathCount = player.getDynamicProperty("deathCount") as number ?? 0;
    const { x, y, z } = player.location;
    const locationPlayer = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
    const lifeCount: number = (player.getComponent(EntityComponentTypes.Health)as EntityHealthComponent)?.currentValue ?? 0;
    return {
      deathCount,
      locationPlayer,
      lifeCount
    };
  }
}
