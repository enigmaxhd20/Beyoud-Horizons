import {
  system,
  StartupEvent,
  CommandPermissionLevel,
  Player,
  CustomCommandStatus,
  CustomCommandParamType,
  CustomCommandOrigin,
} from '@minecraft/server';
import { randomNumber } from '../../components/generation/random_code/generation';

system.beforeEvents.startup.subscribe((event: StartupEvent) => {
  event.customCommandRegistry.registerEnum('bs:Number', ['number']);

  event.customCommandRegistry.registerCommand(
    {
      name: 'bs:code_generation',
      description: 'create a random code',
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      // mandatoryParameters: [
      //     {
      //      name: 'type',
      //    type: CustomCommandParamType.Enum,
      //      enumName: 'bs:Number',
      //     },
      // ],
    },

    (origin: CustomCommandOrigin, type: string) => {
      const player = origin.sourceEntity;

      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: 'This command can only be used by a player.',
        };
      }

      const generatedCode = randomNumber.getRandomCode(11);

      player.sendMessage(`§aYour code: §e${generatedCode}`);

      return {
        status: CustomCommandStatus.Success,
        message: 'Code generated successfully!',
      };
    },
  );
});
