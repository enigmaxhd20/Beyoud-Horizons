import { world } from "@minecraft/server";
import { UiQueueManager } from "./module/T.js";

export let GlobalUIDatabase = [];

export class UI {
  id: string;
  source: any;
  queue: any[];
  ticksRemaining: number;
  lastDimension: string;
  isFullyLoaded: boolean;
  loadDelayTicks: number;

  constructor(player: any) {
    this.id = player.id;
    this.source = player;
    this.queue = [];
    this.ticksRemaining = 0;
    this.lastDimension = player.dimension.id;

    this.isFullyLoaded = false;
    this.loadDelayTicks = 20;

    GlobalUIDatabase.push(this);
  }

  static getUI(player) {
    let data = GlobalUIDatabase.find(f => f.id == player.id);
    if (!data) data = new UI(player);
    return data;
  }

  addUI(identifier, input) {
    UiQueueManager.enqueueTitle(this, identifier, input, false);
  }

  addUIFirst(identifier, input) {
    UiQueueManager.enqueueTitle(this, identifier, input, true);
  }

  addUISub(identifier, input) {
    UiQueueManager.enqueueSubtitle(this, identifier, input, false);
  }

  addUISubFirst(identifier, input) {
    UiQueueManager.enqueueSubtitle(this, identifier, input, true);
  }

  remove() {
    GlobalUIDatabase = GlobalUIDatabase.filter(f => f.id != this.id);
    this.queue = [];
    this.source = null;
  }
}

// Simple Bridge Functions to map event strings
export function handleUILoadOld(s) {
  if (s.id != "ui:set" || !s.sourceEntity) return;
  const ui_data = UI.getUI(s.sourceEntity);
  const data = s.message.split(" ");
  const identifier = data[1];
  ui_data.addUI(identifier, s.message.substring(s.message.indexOf(identifier)));
}

export function handleUILoadLegacy(s) {
  if (!s.sourceEntity) return;
  const ui_data = UI.getUI(s.sourceEntity);
  const identifier = s.id.split(":")[1];
  ui_data.addUI(identifier, s.message);
}

export function handleUISubLoadLegacy(s) {
  if (!s.sourceEntity) return;
  const ui_data = UI.getUI(s.sourceEntity);
  const identifier = s.id.split(":")[1];
  ui_data.addUISub(identifier, s.message);
}

export function handleUILoad(s) {
  const data = s.message.split("|");
  const entity = world.getEntity(data[0]);
  if (!entity) return;
  const ui_data = UI.getUI(entity);
  const identifier = s.id.split(":")[1];
  ui_data.addUI(identifier, s.message.substring(data[0].length + 1));
}

export function handleUISubLoad(s) {
  const data = s.message.split("|");
  const entity = world.getEntity(data[0]);
  if (!entity) return;
  const ui_data = UI.getUI(entity);
  const identifier = s.id.split(":")[1];
  ui_data.addUISub(identifier, s.message.substring(data[0].length + 1));
}

export function handlePlayerJoin(s) {
  if (!s.initialSpawn) return;
  if (!UI.getUI(s.player)) new UI(s.player);
}

export function handleWorldLoad() {
  world.getPlayers().forEach(player => {
    if (!UI.getUI(player)) new UI(player);
  });
}

export function handlePlayerLeave(s) {
  const instance = GlobalUIDatabase.find(f => f.id === s.player.id);
  if (instance) instance.remove();
}
