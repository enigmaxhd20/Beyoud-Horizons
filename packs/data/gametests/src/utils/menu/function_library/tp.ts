import { Player, system } from "@minecraft/server";

interface TeleportActions {
  Spawn: (player: Player) => void;
  Captol_Small: (player: Player) => void;
  Captol_Large: (player: Player) => void;
  Captol_Big: (player: Player) => void;
  Atomics_Small: (player: Player) => void;
  Atomics_Large: (player: Player) => void;
  Atomics_Big: (player: Player) => void;
}

export const Tp: TeleportActions = {
  Spawn(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/home");
    });
  },
  Captol_Small(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/captol/captol_small");
    });
  },
  Captol_Large(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/captol/captol_large");
    });
  },
  Captol_Big(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/captol/captol_big");
    });
  },
  Atomics_Small(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/atomics/atomics_small");
    });
  },
  Atomics_Large(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/atomics/atomics_large");
    });
  },
  Atomics_Big(player: Player): void {
    system.run(() => {
      player.runCommand("function teleportation/atomics/atomics_big");
    });
  },
};

