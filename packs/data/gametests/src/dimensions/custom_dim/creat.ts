import { world, system } from "@minecraft/server";

interface CustomDimensionPlatformConfig {
  name: string;
  radius: number;
  center: {
    x: number;
    y: number;
    z: number;
  };
}

export class CreatDimensions {
  static set(id: string, dimensionsSettings: CustomDimensionPlatformConfig[]): void {
    try {
      system.beforeEvents.startup.subscribe((event) => {
        event.dimensionRegistry.registerCustomDimension(id);
      });

      const builtDimensions = new Set<string>();

      world.afterEvents.worldLoad.subscribe(() => {
        for (const platform of dimensionsSettings) {
          void ensurePlatformBuilt(platform, builtDimensions);
        }
      });

      async function ensurePlatformBuilt(
        config: CustomDimensionPlatformConfig,
        builtSet: Set<string>
      ): Promise<void> {
        if (builtSet.has(config.name)) return;

        const dimension = world.getDimension(config.name);
        const tickingAreaId = `${config.name}_platform`;
        const margin = 2;

        await world.tickingAreaManager.createTickingArea(tickingAreaId, {
          dimension,
          from: {
            x: config.center.x - config.radius - margin,
            y: config.center.y - 1,
            z: config.center.z - config.radius - margin,
          },
          to: {
            x: config.center.x + config.radius + margin,
            y: config.center.y + 4,
            z: config.center.z + config.radius + margin,
          },
        });

        builtSet.add(config.name);
      }
    } catch {
      // ignored intentionally
    }
  }
}