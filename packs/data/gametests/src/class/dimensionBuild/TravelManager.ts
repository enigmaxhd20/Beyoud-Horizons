import * as mc from "@minecraft/server";
import { EntityComponentTypes, ItemStack, system, world } from "@minecraft/server";
import type { Dimension, Player } from "@minecraft/server";
import { Ambience, playerKey } from "./Ambience";
import { logError } from "./log";
import type {
  DimensionJson, EntryTrigger, EntryTriggersJson, LoadingJson, StarterLanding, Vec3,
} from "./types";
import type { PaleForestTerrain } from "./PaleForestTerrain";

// ===========================================================================
// TravelManager — entering/leaving the dimension.
//
// Coordinates: dimension = Overworld * terrain.coordinateScale (e.g. 1.2).
//  • Enter : the player arrives at the shrine nearest to (x*scale, z*scale);
//            if none is nearby, a new one is built there.
//  • Leave : if the player is at the shrine they entered through, they return
//            EXACTLY to the saved point; otherwise they return to (x/scale, z/scale)
//            in the Overworld, on safe ground (never again the bed spawn thousands of blocks away).
//  • The return point is stored on the player itself (dynamic property), so it
//    survives relogging/restarting.
// ===========================================================================

const OVERWORLD_IDS = new Set(["overworld", "minecraft:overworld"]);
const SOUND_USE = ["respawn_anchor.charge", "respawn_anchor.set_spawn"] as const;
const SOUND_DELAY_TICKS = 2;
const TRIGGER_DELAY_TICKS = 5;
const ENTER_WAIT_CHUNK_TICKS = 200;
const LEAVE_WAIT_CHUNK_TICKS = 300;
const FREEZE_EXTRA_SAFETY_TICKS = 300;
const ENTER_MESSAGE = "§7You step through the pale oak door and arrive in the Pale Forest.";
const UNSAFE_GROUND = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:water", "minecraft:flowing_water",
  "minecraft:magma", "minecraft:fire", "minecraft:soul_fire", "minecraft:cactus",
  "minecraft:sweet_berry_bush", "minecraft:powder_snow", "minecraft:campfire", "minecraft:soul_campfire",
]);

interface ReturnRecord { x: number; y: number; z: number; shrineX: number; shrineZ: number }
interface Slot { hasItem(): boolean; typeId?: string; amount: number; setItem(item?: ItemStack): void }
interface Inventory { container?: { getSlot(i: number): Slot; addItem(item: ItemStack): ItemStack | undefined } }

export interface TravelDeps {
  terrain: PaleForestTerrain;
  ambience: Ambience;
  dimension: DimensionJson;
  loading: LoadingJson;
  /** round generation radius (blocks) that follows the player's render distance */
  renderRadius: (player: Player) => number;
  entry: EntryTriggersJson;
  /** resolves the seed and loads the saved shrines (idempotent) */
  ensureReady: () => void;
}

export class TravelManager {
  private readonly cooldowns = new Map<string, number>();
  private readonly traveling = new Set<string>();

  constructor(private readonly d: TravelDeps) {}

  // =========================================================================
  // Queries
  // =========================================================================

  isOverworld(id: string): boolean { return OVERWORLD_IDS.has(id); }
  isCustom(id: string): boolean { return id === this.d.dimension.id; }

  get commandsEnabled(): boolean { return this.d.entry.commandsEnabled; }

  isTraveling(player: Player): boolean { return this.traveling.has(playerKey(player)); }

  private cooling(key: string): boolean { return system.currentTick < (this.cooldowns.get(key) ?? 0); }
  private setCooldown(key: string, ticks: number): void { this.cooldowns.set(key, system.currentTick + ticks); }

  private valid(player: Player): boolean {
    try {
      const v = (player as unknown as { isValid?: boolean | (() => boolean) }).isValid;
      return typeof v === "function" ? v.call(player) : v !== false;
    } catch { return false; }
  }

  private dimOf(player: Player): string | undefined {
    try { return player.dimension.id; } catch { return undefined; }
  }

  // =========================================================================
  // Triggers (src/dimension/data/world/entry_triggers.json)
  // =========================================================================

  private applies(t: EntryTrigger, dimId: string): boolean {
    if (!t.enabled) return false;
    return t.direction === "enter" ? this.isOverworld(dimId) : this.isCustom(dimId);
  }

  matchBlock(player: Player, blockId: string): EntryTrigger | undefined {
    if (!this.d.entry.enabled) return undefined;
    const dimId = this.dimOf(player);
    if (!dimId) return undefined;
    for (const t of this.d.entry.triggers) {
      if (t.kind !== "block" || !this.applies(t, dimId)) continue;
      if (!t.blocks?.includes(blockId)) continue;
      if (t.sneak && !(player as unknown as { isSneaking?: boolean }).isSneaking) continue;
      if (!this.holds(player, t.item)) continue;
      return t;
    }
    return undefined;
  }

  matchItem(player: Player, itemId: string): EntryTrigger | undefined {
    if (!this.d.entry.enabled) return undefined;
    const dimId = this.dimOf(player);
    if (!dimId) return undefined;
    for (const t of this.d.entry.triggers) {
      if (t.kind !== "item" || !this.applies(t, dimId)) continue;
      if (t.item !== itemId) continue;
      if (t.sneak && !(player as unknown as { isSneaking?: boolean }).isSneaking) continue;
      return t;
    }
    return undefined;
  }

  // =========================================================================
  // Inventory
  // =========================================================================

  private selectedSlot(player: Player): Slot | undefined {
    try {
      const inv = player.getComponent(EntityComponentTypes.Inventory) as unknown as Inventory | undefined;
      return inv?.container?.getSlot(player.selectedSlotIndex);
    } catch { return undefined; }
  }

  private holds(player: Player, itemId?: string): boolean {
    if (!itemId) return true;
    const slot = this.selectedSlot(player);
    return !!slot?.hasItem() && slot.typeId === itemId;
  }

  private consume(player: Player, itemId: string): boolean {
    const slot = this.selectedSlot(player);
    if (!slot?.hasItem() || slot.typeId !== itemId) return false;
    try {
      if (slot.amount > 1) slot.amount = slot.amount - 1; else slot.setItem();
      return true;
    } catch { return false; }
  }

  private giveBack(player: Player, itemId: string): void {
    try {
      const inv = player.getComponent(EntityComponentTypes.Inventory) as unknown as Inventory | undefined;
      const left = inv?.container?.addItem(new ItemStack(itemId, 1));
      if (left) player.dimension.spawnItem(left, player.location);
    } catch {}
  }

  // =========================================================================
  // Freeze movement (movement only; the camera stays free)
  // =========================================================================

  freeze(player: Player, on: boolean): void {
    try {
      const perms = (player as unknown as {
        inputPermissions?: { setPermissionCategory(c: unknown, enabled: boolean): void };
      }).inputPermissions;
      const category = (mc as unknown as { InputPermissionCategory?: { Movement?: unknown } }).InputPermissionCategory?.Movement;
      if (perms && category !== undefined) perms.setPermissionCategory(category, !on);
    } catch {}
  }

  // =========================================================================
  // Return point / persisted shrines
  // =========================================================================

  private saveReturn(player: Player, rec: ReturnRecord): void {
    try { player.setDynamicProperty(this.d.dimension.returnPropertyKey, JSON.stringify(rec)); } catch {}
  }

  private loadReturn(player: Player): ReturnRecord | undefined {
    try {
      const raw = player.getDynamicProperty(this.d.dimension.returnPropertyKey);
      if (typeof raw !== "string") return undefined;
      const r = JSON.parse(raw) as Partial<ReturnRecord>;
      if ([r.x, r.y, r.z, r.shrineX, r.shrineZ].every((n) => typeof n === "number" && Number.isFinite(n))) return r as ReturnRecord;
    } catch {}
    return undefined;
  }

  /** Reads the shrines saved in the world (call once, after the world has loaded). */
  loadShrines(): void {
    try {
      const raw = world.getDynamicProperty(this.d.dimension.shrinesPropertyKey);
      if (typeof raw !== "string") return;
      const list = JSON.parse(raw) as Array<{ x: number; z: number; r: number }>;
      for (const s of list) {
        if (Number.isFinite(s.x) && Number.isFinite(s.z)) this.d.terrain.registerShrine(s.x, s.z, Number.isFinite(s.r) ? s.r : 8);
      }
    } catch {}
  }

  private saveShrines(): void {
    try { world.setDynamicProperty(this.d.dimension.shrinesPropertyKey, JSON.stringify(this.d.terrain.getShrines())); } catch {}
  }

  // =========================================================================
  // Travel
  // =========================================================================

  private playSound(player: Player): void {
    try { player.playSound(SOUND_USE[0], { volume: 0.95, pitch: 1.0 }); } catch {}
    system.runTimeout(() => { try { player.playSound(SOUND_USE[1], { volume: 0.85, pitch: 1.0 }); } catch {} }, SOUND_DELAY_TICKS);
  }

  /** `trigger` may be omitted (admin command): no sound, no item consumed. */
  begin(player: Player, direction: "enter" | "exit", trigger?: EntryTrigger): boolean {
    const key = playerKey(player);
    if (this.traveling.has(key) || this.cooling(key)) return false;

    const dimId = this.dimOf(player);
    if (!dimId) return false;
    if (direction === "enter" && !this.isOverworld(dimId)) return false;
    if (direction === "exit" && !this.isCustom(dimId)) return false;

    const spend = !!trigger?.item && !!trigger.consumeItem;
    if (spend && !this.consume(player, trigger!.item!)) return false;

    this.traveling.add(key);
    this.setCooldown(key, 40);
    // safety net: never leaves the player "traveling" forever
    system.runTimeout(() => {
      this.hideLoadingScreen(player, key, true);
      this.traveling.delete(key);
      if (this.valid(player)) this.freeze(player, false);
    }, this.d.loading.maxHoldTicks + FREEZE_EXTRA_SAFETY_TICKS + LEAVE_WAIT_CHUNK_TICKS);

    if (trigger && trigger.sound !== false) this.playSound(player);
    const refund = spend ? (): void => this.giveBack(player, trigger!.item!) : undefined;

    system.runTimeout(() => {
      try {
        if (direction === "enter") this.enter(player, refund);
        else this.leave(player);
      } catch (err) {
        this.fail(player, direction, refund, err);
      }
    }, trigger ? TRIGGER_DELAY_TICKS : 1);
    return true;
  }

  private fail(player: Player, direction: "enter" | "exit", refund: (() => void) | undefined, err?: unknown): void {
    const key = playerKey(player);
    this.hideLoadingScreen(player, key, true);
    this.traveling.delete(key);
    if (!this.valid(player)) return;
    this.freeze(player, false);
    this.d.ambience.setHolding(player, false);
    if (direction === "enter") { try { refund?.(); } catch {} }
    try { player.sendMessage("§cThe journey failed. Please try again."); } catch {}
    logError(`travel ${direction} failed`, err);
  }

  private waitFor(check: () => boolean, done: (ok: boolean) => void, maxTicks: number, every = 2): void {
    const probe = (): boolean => { try { return check(); } catch { return false; } };
    if (probe()) { done(true); return; }
    let waited = 0;
    const id = system.runInterval(() => {
      waited += every;
      const ok = probe();
      if (ok || waited >= maxTicks) { system.clearRun(id); done(ok); }
    }, every);
  }

  // =========================================================================
  // ENTER
  // =========================================================================

  private enter(player: Player, refund?: () => void): void {
    const { terrain, ambience } = this.d;
    this.d.ensureReady();

    const key = playerKey(player);
    const dest = world.getDimension(this.d.dimension.id);
    const from = player.location;

    // Overworld -> dimension (scale) and nearest shrine (or a new one)
    const target = terrain.overworldToDimension(from.x, from.z);
    const existing = terrain.findShrineNear(target.x, target.z);
    const shrine = existing ?? target;
    const planned = terrain.planLanding(shrine.x, shrine.z);

    this.saveReturn(player, { x: from.x, y: from.y, z: from.z, shrineX: shrine.x, shrineZ: shrine.z });
    terrain.beginLoadingBoost(this.d.loading.maxHoldTicks);
    ambience.setHolding(player, true);

    // Frozen, protected and under a black screen from the very first tick, so
    // the native loading screen of the teleport and our own screen are one.
    this.freeze(player, true);
    this.holdMode(player, true);
    this.showLoadingScreen(player);

    // ONE teleport: the player goes straight to the shrine position and is held there
    player.teleport(
      { x: planned.x, y: planned.y, z: planned.z },
      { dimension: dest, checkForBlocks: false, keepVelocity: false },
    );

    this.waitFor(
      () => dest.getBlock({ x: Math.floor(planned.x), y: planned.groundY, z: Math.floor(planned.z) }) !== undefined,
      () => {
        try {
          if (!this.valid(player)) { this.cleanup(key); return; }
          this.arrive(player, dest, shrine, !!existing, refund);
        } catch (err) {
          this.fail(player, "enter", refund, err);
        }
      },
      ENTER_WAIT_CHUNK_TICKS,
      1,
    );
  }

  /**
   * The shrine cell is generated first and the shrine and landing pad are built
   * on it, so the player stands on solid ground while the rest of the core area
   * is generated behind the black screen.
   */
  private arrive(
    player: Player, dest: Dimension, shrine: { x: number; z: number }, shrineExists: boolean, refund?: () => void,
  ): void {
    const { terrain, ambience } = this.d;
    const key = playerKey(player);

    terrain.generateAround(dest, shrine.x, shrine.z, 1, 0);
    const landing: StarterLanding = shrineExists
      ? terrain.planLanding(shrine.x, shrine.z)
      : terrain.buildShrine(dest, shrine.x, shrine.z);
    terrain.ensureLandingPad(dest, landing);
    this.saveShrines();

    // Only reposition if the player really is misplaced (avoids a second camera jump)
    try {
      const loc = player.location;
      const misplaced = this.dimOf(player) !== this.d.dimension.id ||
        Math.hypot(loc.x - landing.x, loc.z - landing.z) > 3 || loc.y < landing.groundY - 1.5;
      if (misplaced) {
        player.teleport(
          { x: landing.x, y: landing.y, z: landing.z },
          { dimension: dest, checkForBlocks: false, keepVelocity: false },
        );
      }
    } catch {}

    ambience.onEnter(player);

    // Hold the black screen only until the round area around the arrival point exists.
    const radius = Math.min(this.d.loading.arrivalRadius, this.d.renderRadius(player));
    if (radius <= 0) { this.release(player, key, ENTER_MESSAGE); return; }
    this.hold(player, key, radius, refund);
  }

  /** Holds the screen until the arrival circle is generated (the streaming itself is the normal terrain streaming). */
  private hold(player: Player, key: string, radius: number, refund?: () => void): void {
    const every = Math.max(1, this.d.loading.progressIntervalTicks);
    const maxHold = this.d.loading.maxHoldTicks;
    const { terrain } = this.d;
    let waited = 0;
    const id = system.runInterval(() => {
      waited += every;
      try {
        if (!this.valid(player) || this.dimOf(player) !== this.d.dimension.id) {
          system.clearRun(id);
          this.cleanup(key);
          return;
        }
        terrain.streamAroundPlayer(player, radius);
        try { player.onScreenDisplay.setActionBar("§7Generating the Pale Forest..."); } catch {}

        if (!terrain.pendingWork || waited >= maxHold) {
          system.clearRun(id);
          this.release(player, key, ENTER_MESSAGE);
        }
      } catch (err) {
        system.clearRun(id);
        this.fail(player, "enter", refund, err);
      }
    }, every);
  }

  // =========================================================================
  // Loading screen (black camera fade held until the arrival is ready)
  // =========================================================================

  private fade(player: Player, fadeIn: number, hold: number, fadeOut: number): void {
    try {
      const cam = (player as unknown as { camera?: { fade(o: unknown): void } }).camera;
      cam?.fade({
        fadeColor: this.d.loading.loadingScreen.color,
        fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut },
      });
    } catch {}
  }

  /** Black screen with a practically infinite hold: it stays until hideLoadingScreen() fades it out. */
  private showLoadingScreen(player: Player): void {
    const cfg = this.d.loading.loadingScreen;
    if (!cfg.fade) return;
    this.fade(player, 0.3, cfg.holdSeconds, 0);
  }

  /** Ends the held state: restores the game mode and fades the black screen out. */
  private hideLoadingScreen(player: Player | undefined, _key: string, fadeOut: boolean): void {
    if (!player || !this.valid(player)) return;
    this.holdMode(player, false);
    if (fadeOut) this.fade(player, 0, 0, this.d.loading.loadingScreen.fadeOutSeconds);
  }

  // =========================================================================
  // Held state: spectator mode (nothing can hurt the player, no effects needed)
  // + movement locked. The previous game mode is remembered, also in a dynamic
  // property so it is restored even after a crash or re-login.
  // =========================================================================

  private readonly previousModes = new Map<string, string>();

  private holdMode(player: Player, on: boolean): void {
    const key = playerKey(player);
    const prop = this.d.dimension.gameModePropertyKey;
    const p = player as unknown as {
      getGameMode?: () => unknown; setGameMode?: (m: unknown) => void;
      getDynamicProperty(k: string): unknown; setDynamicProperty(k: string, v?: string): void;
    };
    const modes = (mc as unknown as { GameMode?: Record<string, unknown> }).GameMode;
    const lookup = (name: string): unknown =>
      modes?.[name] ?? modes?.[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()] ?? name.toLowerCase();
    try {
      if (on) {
        if (!this.previousModes.has(key)) {
          const current = String(p.getGameMode?.() ?? "survival");
          const saved = p.getDynamicProperty(prop);
          // spectator here means "left over from an unfinished trip": keep the saved mode
          const keep = current.toLowerCase() === "spectator" && typeof saved === "string" ? saved : current;
          this.previousModes.set(key, keep);
          try { p.setDynamicProperty(prop, keep); } catch {}
        }
        try { p.setGameMode?.(lookup("spectator")); } catch { try { player.runCommand("gamemode spectator @s"); } catch {} }
        return;
      }
      const stored = this.previousModes.get(key) ?? p.getDynamicProperty(prop);
      this.previousModes.delete(key);
      if (typeof stored !== "string") return;
      try { p.setGameMode?.(lookup(stored)); } catch { try { player.runCommand(`gamemode ${stored.toLowerCase()} @s`); } catch {} }
      try { p.setDynamicProperty(prop, undefined); } catch {}
    } catch {}
  }

  private cleanup(key: string): void {
    this.hideLoadingScreen(undefined, key, false);
    this.traveling.delete(key);
  }

  private release(player: Player, key: string, message: string): void {
    this.hideLoadingScreen(player, key, true);
    this.freeze(player, false);
    this.d.ambience.setHolding(player, false);
    this.d.ambience.refreshLighting(player);
    this.d.ambience.scheduleMusic(player);
    this.traveling.delete(key);
    this.setCooldown(key, 60);
    try { player.onScreenDisplay.setActionBar(""); } catch {}
    try { player.sendMessage(message); } catch {}
  }

  // =========================================================================
  // LEAVE
  // =========================================================================

  private leave(player: Player): void {
    const { terrain, ambience } = this.d;
    const key = playerKey(player);
    const here = player.location;
    const rec = this.loadReturn(player);

    // Decide where to return
    let tx: number, tz: number;
    let exactY: number | undefined;
    const near = terrain.findShrineNear(here.x, here.z);
    if (rec && near && near.x === rec.shrineX && near.z === rec.shrineZ) {
      tx = rec.x; tz = rec.z; exactY = rec.y;                 // same shrine: exact point of origin
    } else if (near) {
      const m = terrain.dimensionToOverworld(near.x, near.z); // different shrine: its coordinates
      tx = m.x + 0.5; tz = m.z + 0.5;
    } else {
      const m = terrain.dimensionToOverworld(here.x, here.z); // outside any shrine: where the player is (x / scale)
      tx = m.x + 0.5; tz = m.z + 0.5;
    }

    terrain.forgetPlayer(key);
    ambience.onLeave(player);
    this.freeze(player, true);
    this.holdMode(player, true);
    this.showLoadingScreen(player);

    const ow = world.getDimension("minecraft:overworld");
    const startY = exactY !== undefined ? exactY + 0.1 : 319;
    player.teleport({ x: tx, y: startY, z: tz }, { dimension: ow, checkForBlocks: false, keepVelocity: false });

    let found: Vec3 | undefined;
    this.waitFor(
      () => { found = this.overworldSpot(ow, tx, tz, exactY); return found !== undefined; },
      (ok) => {
        try {
          if (!this.valid(player)) { this.traveling.delete(key); return; }
          const spot = ok && found ? found : this.fallbackSpot(rec, tx, tz);
          const loc = player.location;
          if (Math.abs(loc.y - spot.y) > 0.6 || Math.hypot(loc.x - spot.x, loc.z - spot.z) > 1.5) {
            player.teleport(spot, { dimension: ow, checkForBlocks: false, keepVelocity: false });
          }
          this.hideLoadingScreen(player, key, true);
          this.freeze(player, false);
          ambience.clearNightIfEmpty(key);
          this.traveling.delete(key);
          this.setCooldown(key, 30);
          player.sendMessage(ok ? "§7The oak door leads you back to the Overworld." : "§eReturned via a safe fallback point (the terrain took too long to load).");
        } catch (err) {
          this.fail(player, "exit", undefined, err);
        }
      },
      LEAVE_WAIT_CHUNK_TICKS,
      5,
    );
  }

  /**
   * Looks for a safe spot in the Overworld. Returns `undefined` while the chunk
   * has not loaded (so waitFor keeps waiting).
   */
  private overworldSpot(ow: Dimension, x: number, z: number, exactY?: number): Vec3 | undefined {
    const bx = Math.floor(x), bz = Math.floor(z);

    if (exactY !== undefined) {
      const y = Math.floor(exactY);
      const feet = ow.getBlock({ x: bx, y, z: bz });
      if (!feet) return undefined;                                    // not loaded yet
      const head = ow.getBlock({ x: bx, y: y + 1, z: bz });
      const floor = ow.getBlock({ x: bx, y: y - 1, z: bz });
      if (feet.isAir && head?.isAir && floor && !floor.isAir && !floor.isLiquid && !UNSAFE_GROUND.has(floor.typeId)) {
        return { x: bx + 0.5, y: y + 0.05, z: bz + 0.5 };
      }
    }

    // ground by column: if the chunk is not loaded, getTopmostBlock throws
    let center;
    try { center = ow.getTopmostBlock({ x: bx, z: bz }); } catch { return undefined; }

    const offsets: Array<[number, number]> = [[0, 0]];
    for (const r of [2, 4, 6, 8, 10, 12]) {
      offsets.push([r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]);
    }
    for (const [dx, dz] of offsets) {
      try {
        const top = dx === 0 && dz === 0 ? center : ow.getTopmostBlock({ x: bx + dx, z: bz + dz });
        if (!top || UNSAFE_GROUND.has(top.typeId) || top.isLiquid) continue;
        const a1 = ow.getBlock({ x: top.x, y: top.y + 1, z: top.z });
        const a2 = ow.getBlock({ x: top.x, y: top.y + 2, z: top.z });
        if (!a1?.isAir || !a2?.isAir) continue;
        return { x: top.x + 0.5, y: top.y + 1.01, z: top.z + 0.5 };
      } catch {}
    }
    return center ? { x: bx + 0.5, y: center.y + 1.01, z: bz + 0.5 } : undefined;
  }

  private fallbackSpot(rec: ReturnRecord | undefined, x: number, z: number): Vec3 {
    if (rec) return { x: rec.x, y: rec.y + 0.1, z: rec.z };
    try {
      const s = world.getDefaultSpawnLocation();
      return { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5 };
    } catch { return { x, y: 100, z }; }
  }

  // =========================================================================
  // Spawn / relogging inside the dimension
  // =========================================================================

  onPlayerSpawn(player: Player): void {
    this.d.ensureReady();
    const key = playerKey(player);
    this.freeze(player, false);
    if (!this.traveling.has(key)) this.holdMode(player, false);

    const dimId = this.dimOf(player);
    if (!dimId) return;

    if (this.isOverworld(dimId)) {
      this.d.ambience.onLeave(player);
      this.d.ambience.clearNightIfEmpty(key);
      return;
    }
    if (!this.isCustom(dimId)) return;

    const { terrain, ambience } = this.d;
    const dim = player.dimension;
    const loc = player.location;
    try {
      terrain.generateAround(dim, loc.x, loc.z, 1, 0);
      const top = terrain.topYAt(Math.floor(loc.x), Math.floor(loc.z));
      if (loc.y < top - 2) {
        player.teleport(
          { x: loc.x, y: top + 1.01, z: loc.z },
          { dimension: dim, checkForBlocks: false, keepVelocity: false },
        );
      }
    } catch {}
    ambience.onEnter(player);
  }

  /** Removes state for a player who left the game. */
  onPlayerLeaveGame(playerId: string): void {
    this.hideLoadingScreen(undefined, playerId, false);
    this.traveling.delete(playerId);
    this.cooldowns.delete(playerId);
    this.d.terrain.forgetPlayer(playerId);
  }
}
