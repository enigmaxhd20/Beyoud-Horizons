import { system, world, GameMode, type RawMessage } from '@minecraft/server';

export interface Gmo {
  modeBlocked: string | undefined;
}

type ModeKey = 'C' | 'S' | 'Sp' | 'A';

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
    // defaultgamemode não aceita spectator; novos jogadores
    // entram em survival e o load() os move para spectator
    commandMode: 'defaultgamemode survival',
  },
  A: {
    mode: GameMode.Adventure,
    message: { translate: 'meupack.gamemode.blocked.adventure' },
    commandMode: 'defaultgamemode adventure',
  },
};

export class GameModeBlockedWorld {
  private static list(propertyKey: string): Gmo {
    try {
      const rawData = world.getDynamicProperty(propertyKey) as
        | string
        | undefined;
      if (!rawData) return { modeBlocked: 'none' };
      return JSON.parse(rawData) as Gmo;
    } catch (e) {
      console.error(`${e}`);
      return { modeBlocked: 'none' };
    }
  }

  /**
   * Define o modo bloqueado.
   * Use 'C' | 'S' | 'Sp' | 'A' para bloquear.
   * Use 'none' ou undefined para desbloquear.
   */
  public static set(propertyKey: string, value: string | undefined): void {
    try {
      if (value === undefined || value === 'none') {
        world.setDynamicProperty(propertyKey, undefined);
        return;
      }
      if (!(value in MODES)) {
        console.warn(`Modo inválido: ${value}`);
        return;
      }

      const oldValue = this.list(propertyKey);
      if (oldValue.modeBlocked === value) return;

      world.setDynamicProperty(
        propertyKey,
        JSON.stringify({ modeBlocked: value } satisfies Gmo),
      );
      this.load(propertyKey); // aplica na hora
    } catch (e) {
      console.error(`${e}`);
    }
  }

  public static load(propertyKey: string): void {
    try {
      const gamemodeD = this.list(propertyKey);
      if (!gamemodeD.modeBlocked || gamemodeD.modeBlocked === 'none') return;

      const entry = MODES[gamemodeD.modeBlocked as ModeKey];
      if (!entry) return;

      let changed = false;

      for (const player of world.getAllPlayers()) {
        if (player.getGameMode() !== entry.mode) {
          player.setGameMode(entry.mode);
          player.sendMessage(entry.message);
          changed = true;
        }
      }

      // Roda uma vez só, fora do loop (afeta quem entrar depois)
      if (changed) {
        world.getDimension('overworld').runCommand(entry.commandMode);
      }
    } catch (e) {
      console.warn(`error load gamemode: ${e}`);
    }
  }
}

// beforeEvents é somente leitura: adia para o próximo tick,
// quando a troca já foi aplicada e é permitido escrever
world.beforeEvents.playerGameModeChange.subscribe(() => {
  system.run(() => GameModeBlockedWorld.load('GameMode'));
});

world.afterEvents.playerSpawn.subscribe(() => {
  GameModeBlockedWorld.load('GameMode');
});
