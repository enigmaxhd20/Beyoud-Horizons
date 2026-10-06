import {
  Player,
  system,
  world,
  TitleDisplayOptions,
  ScriptEventCommandMessageAfterEvent,
  PlayerJoinAfterEvent,
  PlayerLeaveAfterEvent,
} from '@minecraft/server';

interface UIQueueItem {
  id: string;
  title?: string;
  sub?: string;
  repetition: number;
}

let GlobalUIDatabase: UI[] = [];
const TitleOption: TitleDisplayOptions = {
  fadeInDuration: 0,
  fadeOutDuration: 0,
  stayDuration: 0,
};

// Loop para renderizar a UI de todos os jogadores ativos
system.runInterval(() => {
  GlobalUIDatabase.forEach((ui) => ui.renderUI());
});

export class UI {
  id: string;
  source: Player;
  queue: UIQueueItem[];

  constructor(player: Player) {
    this.id = player.id;
    this.source = player;
    this.queue = [];
    GlobalUIDatabase.push(this);
  }

  static getUI(player: Player): UI {
    let data = GlobalUIDatabase.find((f) => f.id === player.id);
    if (!data) {
      data = new UI(player);
    } else {
      // Atualiza a referência do jogador caso tenha reconectado
      data.source = player;
    }
    return data;
  }

  static removeUI(playerId: string): void {
    const index = GlobalUIDatabase.findIndex((f) => f.id === playerId);
    if (index !== -1) {
      GlobalUIDatabase[index].queue = [];
      GlobalUIDatabase.splice(index, 1);
    }
  }

  addUI(identifier: string, input: unknown): void {
    let data = this.queue.find((f) => f.id === identifier);
    let inQueue = true;

    if (!data) {
      data = { id: identifier, repetition: 3 };
      inQueue = false;
    }

    let parsedInput: unknown = input;
    if (typeof input === 'string') {
      try {
        parsedInput = JSON.parse(input);
      } catch {
        parsedInput = input;
      }
    }

    data.repetition = 3;
    data.title =
      typeof parsedInput === 'number'
        ? parsedInput.toString()
        : String(parsedInput);

    if (!inQueue) this.queue.push(data);
  }

  addUISub(identifier: string, input: unknown): void {
    let data = this.queue.find((f) => f.id === identifier);
    let inQueue = true;

    if (!data) {
      data = { id: identifier, repetition: 3 };
      inQueue = false;
    }

    let parsedInput: unknown = input;
    if (typeof input === 'string') {
      try {
        parsedInput = JSON.parse(input);
      } catch {
        parsedInput = input;
      }
    }

    data.repetition = 3;
    data.sub =
      typeof parsedInput === 'number'
        ? parsedInput.toString()
        : String(parsedInput);

    if (!inQueue) this.queue.push(data);
  }

  renderUI(): void {
    // 1. Se a fila estiver vazia, não há o que processar
    if (this.queue.length === 0) return;

    // 2. Valida se a entidade do jogador está pronta/carregada (isValid === true).
    // A checagem é feita sem parênteses (), pois 'isValid' é uma propriedade booleana.
    if (!this.source || !this.source.isValid) return;

    // 3. O jogador está válido: desempilha o primeiro item da fila
    const current = this.queue.shift();
    if (!current) return;

    if (current.title !== undefined) {
      const option: TitleDisplayOptions = {
        ...TitleOption,
        subtitle: current.sub,
      };
      this.source.onScreenDisplay.setTitle(current.title, option);
    }

    if (current.repetition > 0) {
      current.repetition -= 1;
      this.queue.push(current);
    }
  }
}

// Handlers de ScriptEvent (scriptevent ui:set <identifier> <message>)
export function handleUILoadOld(s: ScriptEventCommandMessageAfterEvent): void {
  if (s.id !== 'ui:set' || !(s.sourceEntity instanceof Player)) return;

  const uiData = UI.getUI(s.sourceEntity);
  const spaceIndex = s.message.indexOf(' ');
  if (spaceIndex === -1) return;

  const identifier = s.message.substring(0, spaceIndex);
  const content = s.message.substring(spaceIndex + 1);

  uiData.addUI(identifier, content);
}

export function handleUILoadLegacy(
  s: ScriptEventCommandMessageAfterEvent,
): void {
  if (!(s.sourceEntity instanceof Player)) return;

  const uiData = UI.getUI(s.sourceEntity);
  const identifier = s.id.split(':')[1];
  uiData.addUI(identifier, s.message);
}

export function handleUISubLoadLegacy(
  s: ScriptEventCommandMessageAfterEvent,
): void {
  if (!(s.sourceEntity instanceof Player)) return;

  const uiData = UI.getUI(s.sourceEntity);
  const identifier = s.id.split(':')[1];
  uiData.addUISub(identifier, s.message);
}

export function handleUILoad(s: ScriptEventCommandMessageAfterEvent): void {
  const data = s.message.split('|');
  const targetEntity = world.getEntity(data[0]);

  if (!(targetEntity instanceof Player)) return;

  const uiData = UI.getUI(targetEntity);
  const identifier = s.id.split(':')[1];
  uiData.addUI(identifier, s.message.substring(data[0].length + 1));
}

export function handleUISubLoad(s: ScriptEventCommandMessageAfterEvent): void {
  const data = s.message.split('|');
  const targetEntity = world.getEntity(data[0]);

  if (!(targetEntity instanceof Player)) return;

  const uiData = UI.getUI(targetEntity);
  const identifier = s.id.split(':')[1];
  uiData.addUISub(identifier, s.message.substring(data[0].length + 1));
}

// Handlers de Eventos de Jogador e Mundo
export function handlePlayerJoin(s: PlayerJoinAfterEvent): void {
  const player = world.getEntity(s.playerId);
  if (player instanceof Player) {
    UI.getUI(player);
  }
}

export function handleWorldLoad(): void {
  world.getPlayers().forEach((player) => {
    UI.getUI(player);
  });
}

export function handlePlayerLeave(s: PlayerLeaveAfterEvent): void {
  UI.removeUI(s.playerId);
}
