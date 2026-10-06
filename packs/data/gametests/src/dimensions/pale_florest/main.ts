import { ItemStack, system, world } from "@minecraft/server";
import type { Dimension, Player } from "@minecraft/server";
import { Ambience, playerKey } from "../../class/dimensionBuild/Ambience";
import { dimensionCfg, entryCfg, mobsCfg, loadingCfg, musicCfg, renderCfg, seedCfg, terrainData, timeCfg } from "./config";
import { logError } from "../../class/dimensionBuild/log";
import { PaleForestTerrain } from "../../class/dimensionBuild/PaleForestTerrain";
import { TravelManager } from "../../class/dimensionBuild/TravelManager";

// ===========================================================================
// main.ts — script that USES the PaleForestTerrain class.
// Coordinate scale is defined here, when instantiating the class.
// ===========================================================================

const COORDINATE_SCALE = 1.2;

const terrain = new PaleForestTerrain({
  dimensionId: dimensionCfg.id,
  coordinateScale: COORDINATE_SCALE,
  data: terrainData,
});
const ambience = new Ambience(dimensionCfg.id, dimensionCfg, timeCfg, musicCfg);

// ---- seed -----------------------------------------------------------------

function seedToInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "bigint") {
    const u = BigInt.asUintN(64, value);
    return (Number(u & 0xffffffffn) ^ Number((u >> 32n) & 0xffffffffn)) | 0;
  }
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) | 0 : undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return undefined;
    if (/^-?\d+$/.test(text)) {
      try { return Number(BigInt.asIntN(32, BigInt(text))); } catch {}
      return Math.trunc(Number(text)) | 0;
    }
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h | 0;
  }
  return undefined;
}

function storedSeed(key: string): number | undefined {
  try { const v = world.getDynamicProperty(key); if (typeof v === "number") return v | 0; } catch {}
  return undefined;
}

function apiSeed(): number | undefined {
  try {
    const w = world as unknown as { seed?: unknown; getSeed?: () => unknown };
    return seedToInt(w.seed ?? (typeof w.getSeed === "function" ? w.getSeed() : undefined));
  } catch { return undefined; }
}

function resolveSeed(): number {
  if (seedCfg.useWorldSeed) { const s = apiSeed(); if (s !== undefined) return s; }
  const manual = seedToInt(seedCfg.manualSeed);
  if (manual !== undefined) return manual;
  const override = storedSeed(seedCfg.overrideKey);
  if (override !== undefined) return override;
  if (!seedCfg.useWorldSeed) { const s = apiSeed(); if (s !== undefined) return s; }
  const auto = storedSeed(seedCfg.autoKey);
  if (auto !== undefined) return auto;
  const generated = Math.floor(Math.random() * 4294967296) | 0;
  try { world.setDynamicProperty(seedCfg.autoKey, generated); } catch {}
  return generated;
}

/** Round generation radius (blocks) that follows the player's render distance. */
function renderRadius(player: Player): number {
  let chunks = renderCfg.fallbackChunks;
  if (renderCfg.useClientRenderDistance) {
    try {
      const v = (player as unknown as { clientSystemInfo?: { maxRenderDistance?: number } }).clientSystemInfo?.maxRenderDistance;
      if (typeof v === "number" && v > 0) chunks = v;
    } catch {}
  }
  const r = (chunks + renderCfg.extraChunks) * 16;
  return Math.max(renderCfg.minRadius, Math.min(renderCfg.maxRadius, r));
}

let travel: TravelManager;
let shrinesLoaded = false;

function ensureReady(): void {
  if (!terrain.ready) terrain.setSeed(resolveSeed());
  if (!shrinesLoaded && terrain.ready) { shrinesLoaded = true; travel.loadShrines(); }
}

travel = new TravelManager({
  terrain, ambience,
  dimension: dimensionCfg, loading: loadingCfg, entry: entryCfg,
  renderRadius: (player) => renderRadius(player),
  ensureReady,
});

// ---- startup / events ----------------------------------------------------

// Registration (custom dimension + dimension clock) runs once, in world.beforeEvents.worldInitialize.
// Newer API versions replaced that event with system.beforeEvents.startup, so it is used as a fallback.
let registered = false;

function onInitialize(event: unknown): void {
  if (registered) return;
  registered = true;
  try {
    (event as { dimensionRegistry: { registerCustomDimension(id: string): void } })
      .dimensionRegistry.registerCustomDimension(dimensionCfg.id);
  } catch (err) { logError("register dimension", err); }
  try { ambience.registerClock(event); } catch (err) { logError("register clock", err); }
}

type Subscribable = { subscribe(cb: (event: unknown) => void): unknown };
const worldInit = (world.beforeEvents as unknown as { worldInitialize?: Subscribable }).worldInitialize;
const systemStartup = (system.beforeEvents as unknown as { startup?: Subscribable }).startup;
if (worldInit) worldInit.subscribe(onInitialize);
else systemStartup?.subscribe(onInitialize);

// world.afterEvents.worldLoad: resolve the seed and load the saved shrines.
function onWorldLoad(): void {
  try { ensureReady(); } catch (err) { logError("world load", err); }
}

const worldLoad = (world.afterEvents as unknown as { worldLoad?: { subscribe(cb: () => void): unknown } }).worldLoad;
if (worldLoad) worldLoad.subscribe(onWorldLoad);
else system.run(onWorldLoad);

world.afterEvents.playerSpawn.subscribe((event) => {
  try { travel.onPlayerSpawn(event.player); } catch {}
});

world.afterEvents.playerLeave.subscribe((event) => {
  try {
    travel.onPlayerLeaveGame(event.playerId);
    ambience.clearNightIfEmpty(event.playerId);
  } catch {}
});

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  try {
    const trigger = travel.matchBlock(event.player, event.block.typeId);
    if (!trigger) return;
    event.cancel = true;
    if (!event.isFirstEvent) return;
    const player = event.player;
    system.run(() => { try { travel.begin(player, trigger.direction, trigger); } catch {} });
  } catch {}
});

world.beforeEvents.itemUse.subscribe((event) => {
  try {
    const item = event.itemStack;
    if (!item) return;
    const trigger = travel.matchItem(event.source, item.typeId);
    if (!trigger) return;
    event.cancel = true;
    const player = event.source;
    system.run(() => { try { travel.begin(player, trigger.direction, trigger); } catch {} });
  } catch {}
});

// ---- trial key when hitting a creaking ---------------------------------

const keyCooldowns = new Map<string, number>();

world.afterEvents.entityHitEntity.subscribe((event) => {
  try {
    const hit = event.hitEntity;
    const attacker = event.damagingEntity;
    if (!hit || !attacker || attacker.typeId !== "minecraft:player") return;
    if (hit.typeId !== "minecraft:creaking") return;
    if (hit.dimension.id !== dimensionCfg.id) return;

    const cfg = mobsCfg.creakingTrialKey;
    const k = hit.id;
    if ((keyCooldowns.get(k) ?? 0) > system.currentTick) return;
    keyCooldowns.set(k, system.currentTick + cfg.entityCooldownTicks);
    if (Math.random() >= cfg.dropChance) return;

    const at = { x: hit.location.x, y: hit.location.y + 1, z: hit.location.z };
    hit.dimension.spawnItem(new ItemStack("minecraft:trial_key", 1), at);
    try { (attacker as Player).playSound("vault.activate", { location: at, volume: 0.9 }); } catch {}
  } catch {}
});

// ---- script commands ----------------------------------------------------

system.afterEvents.scriptEventReceive.subscribe((event) => {
  try {
    const player = event.sourceEntity as Player | undefined;
    const isPlayer = player?.typeId === "minecraft:player";
    switch (event.id) {
      case "paleforest:enter":
      case "paleforest:exit": {
        if (!travel.commandsEnabled || !isPlayer || !player) return;
        travel.begin(player, event.id.endsWith("enter") ? "enter" : "exit");
        break;
      }
      case "paleforest:seed": {
        const msg = event.message.trim();
        if (msg === "") {
          ensureReady();
          const text = `[PaleForest] current seed: ${terrain.getSeed()} | scale: ${COORDINATE_SCALE}`;
          if (isPlayer && player) player.sendMessage(text); else world.sendMessage(text);
          return;
        }
        const s = seedToInt(msg);
        if (s === undefined) return;
        world.setDynamicProperty(seedCfg.overrideKey, s);
        terrain.setSeed(s);
        const text = `[PaleForest] seed set: ${s}. Already generated areas do not change.`;
        if (isPlayer && player) player.sendMessage(text); else world.sendMessage(text);
        break;
      }
      case "paleforest:timeinfo": {
        const clock = ambience.getClock();
        const text = clock
          ? `[PaleForest] clock ${timeCfg.clockId}: time=${clock.time} paused=${clock.isPaused}`
          : "[PaleForest] custom clock unavailable (enable Beta APIs + Creator World Clocks Features)";
        if (isPlayer && player) player.sendMessage(text); else world.sendMessage(text);
        break;
      }
      case "paleforest:fx": {
        // Re-applies night + fog to the caller and reports what each route returned (diagnostics).
        if (!isPlayer || !player) return;
        ambience.applyNight();
        ambience.forceFog(player);
        const d = ambience.diag;
        player.sendMessage(`[PaleForest] in dimension: ${ambience.isHere(player)} | time: ${d.time} | day cycle: ${d.cycle} | fog: ${d.fog}`);
        break;
      }
      case "paleforest:unfreeze": {
        if (isPlayer && player) travel.freeze(player, false);
        break;
      }
    }
  } catch {}
});

// ---- loops -------------------------------------------------------------------

function anyoneInDimension(): boolean { return ambience.anyoneHere() || terrain.pendingWork; }

system.runInterval(() => {
  try {
    for (const [k, t] of keyCooldowns) if (t <= system.currentTick) keyCooldowns.delete(k);
    if (!terrain.ready || !anyoneInDimension()) return;
    terrain.tick();
  } catch (err) { logError("tick loop", err); }
}, 1);

system.runInterval(() => {
  try {
    if (!terrain.ready) return;
    for (const player of world.getPlayers()) {
      if (travel.isTraveling(player)) continue;
      ambience.sweep(player);
      if (ambience.isHere(player)) terrain.streamAroundPlayer(player, renderRadius(player));
    }
    if (ambience.anyoneHere()) ambience.keepNight();
    else ambience.clearNightIfEmpty();
  } catch (err) { logError("player scan loop", err); }
}, Math.max(1, terrainData.throughput.scanIntervalTicks));

function groundOk(dim: Dimension, x: number, z: number): number | undefined {
  if (!terrain.columnLooksEstablished(dim, x, z)) return undefined;
  const y = terrain.topYAt(x, z);
  try {
    const below = dim.getBlock({ x, y, z })?.typeId;
    const feet = dim.getBlock({ x, y: y + 1, z })?.typeId;
    const head = dim.getBlock({ x, y: y + 2, z })?.typeId;
    if (!below || below === "minecraft:air") return undefined;
    if (feet !== "minecraft:air" || head !== "minecraft:air") return undefined;
  } catch { return undefined; }
  return y;
}

system.runInterval(() => {
  try {
    const w = mobsCfg.warden;
    for (const player of world.getPlayers()) {
      if (!ambience.isHere(player) || travel.isTraveling(player)) continue;
      if (Math.random() >= w.spawnChance) continue;
      const dim = player.dimension, loc = player.location;
      if ([...dim.getEntities({ type: "minecraft:warden", location: loc, maxDistance: w.existingRadius })].length > 0) continue;
      for (let i = 0; i < w.spawnAttempts; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = w.minSpawnDistance + Math.floor(Math.random() * (w.maxSpawnDistance - w.minSpawnDistance + 1));
        const x = Math.floor(loc.x + Math.cos(ang) * d), z = Math.floor(loc.z + Math.sin(ang) * d);
        const y = groundOk(dim, x, z);
        if (y === undefined) continue;
        try { dim.runCommand(`summon minecraft:warden ${x + 0.5} ${y + 1} ${z + 0.5}`); break; } catch {}
      }
    }
  } catch (err) { logError("warden loop", err); }
}, mobsCfg.warden.checkIntervalTicks);

export { playerKey };
