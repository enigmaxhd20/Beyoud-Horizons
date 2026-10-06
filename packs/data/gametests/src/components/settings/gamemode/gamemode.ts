import { system, Player, world, GameMode, RawMessage } from '@minecraft/server';
import {
  DynamicDefinitionsWorld,
  DynamicObjectWorld,
} from '../../world/dynamicProperty/dynamicProperty';
export interface Gmo {
  modeBlocked: string | undefined;
}
export class GameModeBlockedWorld {
  private static list(propertyKey: string): Gmo | undefined {
    try {
      const rawData: string = (world.getDynamicProperty(
        propertyKey,
      ) as string) ?? {
        modeBlocked: 'none',
      };
      if (!rawData || rawData === undefined) return undefined;
      const finalData: Gmo = JSON.parse(rawData);
      return finalData;
    } catch (e) {
      return {
        modeBlocked: 'none',
      };
      console.error(`${e} `);
    }
  }
  public static set(propertyKey: string, value: string | undefined): void {
    try {
      const oldValue: Gmo = this.list(propertyKey) ?? {
        modeBlocked: 'none',
      };
      const newValue: Gmo = {
        modeBlocked: value,
      };
      if (oldValue === newValue || newValue.modeBlocked === 'none') return;
      const rawNewValue: string = JSON.stringify(newValue);
      if (newValue.modeBlocked === undefined) {
        world.setDynamicProperty(propertyKey, undefined);
      } else {
        world.setDynamicProperty(propertyKey, rawNewValue);
      }
    } catch (e) {
      console.error(`${e} `);
    }
  }
  public static load(propertyKey: string): void {
    try {
      type ModeKey = 'C' | 'S' | 'Sp' | 'A';
      const gamemodeD: Gmo = this.list(propertyKey) ?? { modeBlocked: 'none' };
      if (gamemodeD.modeBlocked === 'none') return;
      const MODES: Record<
        ModeKey,
        { mode: GameMode; message: RawMessage; commandMode: string }
      > = {
        C: {
          mode: GameMode.Creative,
          message: { translate: 'meupack.gamemode.blocked.creative' },
          commandMode: 'defaultgamemode creative',
        },
        S: {
          mode: GameMode.Survival,
          message: { translate: 'meupack.gamemode.blocked.survival' },
          commandMode: 'defaultgamemode survival',
        },
        Sp: {
          mode: GameMode.Spectator,
          message: { translate: 'meupack.gamemode.blocked.spectator' },
          commandMode: 'defaultgamemode survival',
        },
        A: {
          mode: GameMode.Adventure,
          message: { translate: 'meupack.gamemode.blocked.adventure' },
          commandMode: 'defaultgamemode adventure',
        },
      };
      if (gamemodeD.modeBlocked === 'none') return;

      const entry = MODES[gamemodeD.modeBlocked as ModeKey];
      if (!entry) return;

      for (const player of world.getAllPlayers()) {
        if (player.getGameMode() !== entry.mode) {
          player.setGameMode(entry.mode);
          player.sendMessage(entry.message);
          world.getDimension('overworld').runCommand(entry.commandMode);
        }
      }
    } catch (e) {
      console.warn(`error load gamemode:${e}`);
    }
  }
}
world.beforeEvents.playerGameModeChange.subscribe(() => {
  GameModeBlockedWorld.load('GameMode');
});

world.afterEvents.playerSpawn.subscribe(() => {
  GameModeBlockedWorld.load('GameMode');
});


