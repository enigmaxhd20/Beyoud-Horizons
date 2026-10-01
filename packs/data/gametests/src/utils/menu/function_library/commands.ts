import { Player, system } from "@minecraft/server";

interface CommandActions {
  Hello: (player: Player) => void;
  Give: (player: Player) => void;
}

export const Cmds: CommandActions = {
  Hello(player: Player): void {
    system.run(() => {
      player.runCommand("say @s §2Hello ");
    });
  },
  Give(player: Player): void {
    system.run(() => {
      player.runCommand("give @p apple");
    });
  },
};
