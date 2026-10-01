	import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  system,
} from "@minecraft/server";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  // Register an enum for teleport locations
  customCommandRegistry.registerEnum("bs:tpl", ["spawn", "shop", "arena"]);

  // Register the custom command
  customCommandRegistry.registerCommand(
    {
      name: "bs:tpl",
      description: "Teleport to a specific location.",
      permissionLevel: CommandPermissionLevel.Any, // Allow all players to run the command
      cheatsRequired: true, // Allow the command to be ran without enabling cheats
      mandatoryParameters: [
        {
          // Use the enum by setting the name to the enum name
          name: "bs:tpl",
          type: CustomCommandParamType.Enum,
        },
      ],
    },
    (origin, tpl) => {
      // Only run if executed by an entity
      if (!origin.sourceEntity)
        return {
          status: CustomCommandStatus.Failure,
        };

      let location;

      // Handle teleportation based on the location string
      if (tpl === "spawn") {
        location = { x: 0, y: 100, z: 0 };
      } else if (tpl === "shop") {
        location = { x: 100, y: 100, z: 100 };
      } else if (tpl === "arena") {
        location = { x: 200, y: 100, z: 200 };
      }

      system.run(() => {
        origin.sourceEntity.teleport(location);
      });

      return {
        status: CustomCommandStatus.Success,
        message: "Teleporting to " + tpl,
      };
    }
  );
});

