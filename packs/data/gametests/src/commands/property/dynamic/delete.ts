import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  system,
  world
} from "@minecraft/server";
import { WorldData, EntityData, PlayerData, ItemData } from "../../../utils/save_data/data_json/storage.js";

// Function to safely get IDs
function GetId() {
  try {
    const ids = world.getDynamicPropertyIds();
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    return [];
  }
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  const existingIds = GetId();

  customCommandRegistry.registerEnum("bs:target_options", ["entity", "player", "item", "world"]);
  customCommandRegistry.registerEnum("bs:identifier_options", [...existingIds, "all"]);

  customCommandRegistry.registerCommand(
    {
      name: "bs:dynamic_property_delete",
      description: "Deletes specific or all dynamic properties from a target.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
      mandatoryParameters: [
        {
          name: "target_type",
          type: CustomCommandParamType.Enum,
          enumName: "bs:target_options",
        },
        {
          name: "identifier",
          type: CustomCommandParamType.Enum,
          enumName: "bs:identifier_options"
        }
      ],
      optionalParameters: [
        {
          name: "target_object",
          type: CustomCommandParamType.EntitySelector// <--- A correção principal está aqui (String em vez de Target/EntityType)
        }
      ],
    },
    (origin, target_type, identifier, target_object) => {
      const player = origin.sourceEntity;

      if (!player) {
        return {
          status: CustomCommandStatus.Failure,
          message: "§cThis command is only available to players."
        };
      }

      let target;
      const isAll = identifier === "all";

      // Target selection logic based on your original logic
      if (target_type === "world") {
        target = world;
      } else if (target_type === "player") {
        // Se precisar usar a string para buscar outro jogador: 
        // ex: world.getPlayers({name: target_object})[0]; 
        // Por padrão, deixamos o jogador que executou.
        target = player;
      } else if (target_type === "entity") {
        target = player.getEntitiesFromViewDirection()[0]?.entity;
      } else if (target_type === "item") {
        const inv = player.getComponent("inventory") as any;
        const selectedSlotIndex = (player as any).selectedSlotIndex ?? 0;
        target = inv?.container?.getItem(selectedSlotIndex);
      }

      if (!target && target_type !== "world") {
        return {
          status: CustomCommandStatus.Failure,
          message: "§cNo target found. Please look at an entity."
        };
      }

      // Execution logic
      system.run(() => {
        try {
          switch (target_type) {
            case "world":
              isAll ? WorldData.deleteAll() : WorldData.delete(identifier);
              break;
            case "player":
              isAll ? PlayerData.deleteAll(target) : PlayerData.delete(target, identifier);
              break;
            case "entity":
              isAll ? EntityData.deleteAll(target) : EntityData.delete(target, identifier);
              break;
            case "item":
              isAll ? ItemData.deleteAll(target) : ItemData.delete(target, identifier);
              break;
          }
        } catch (err) {
          console.error(`[Dynamic Delete Error]: ${err}`);
        }
      });

      return {
        status: CustomCommandStatus.Success,
        message: `§e[SG] §f${isAll ? "Cleared ALL" : "Deleted " + identifier} §eon §b${target_type}§e.`,
      };
    }
  );
});
