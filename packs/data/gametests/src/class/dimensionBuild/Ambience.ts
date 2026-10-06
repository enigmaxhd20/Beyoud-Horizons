import { system, world } from "@minecraft/server";
import type { Dimension, Player } from "@minecraft/server";
import type { DimensionJson, MusicJson, TimeJson } from "./types";

// ===========================================================================
// Ambience: fog, music and TIME of day for the dimension (only it, via WorldClock).
// Everything comes from src/dimension/data/world/dimension.json, time.json and music.json.
// ===========================================================================

const LIGHTING_REFRESH_DELAYS = [4, 40, 100, 200] as const;

interface WorldClockLike { name?: string; time: number; isPaused: boolean }

export function playerKey(player: Player): string {
  try { return (player as unknown as { id?: string }).id ?? player.name; } catch { return player.name; }
}

export class Ambience {
  private readonly fogged = new Set<string>();
  private readonly playing = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly holding = new Set<string>();
  private legacyGlobalTime = false;

  constructor(
    private readonly dimId: string,
    private readonly dim: DimensionJson,
    private readonly time: TimeJson,
    private readonly music: MusicJson,
  ) {}

  isHere(player: Player): boolean {
    try { return player.dimension.id === this.dimId; } catch { return false; }
  }

  /** A player in the "entry hold" must not hear music yet. */
  setHolding(player: Player, on: boolean): void {
    const k = playerKey(player);
    if (on) this.holding.add(k); else this.holding.delete(k);
  }

  // ---- dimension clock ------------------------------------------------------

  /** Call inside system.beforeEvents.startup. */
  registerClock(event: unknown): void {
    if (!this.time.useWorldClock) return;
    const reg = (event as { worldClockRegistry?: { registerClock(n: string, o?: unknown): void } }).worldClockRegistry;
    if (!reg) return;
    try {
      reg.registerClock(this.time.clockId, { timeMarkers: [{ name: "paleforest:midnight", time: this.time.timeTicks }] });
    } catch {
      try { reg.registerClock(this.time.clockId); } catch {}
    }
  }

  /** This dimension's own clock; never returns minecraft:overworld / minecraft:the_end. */
  getClock(): WorldClockLike | undefined {
    if (!this.time.useWorldClock) return undefined;
    const getters: Array<() => unknown> = [
      () => (world.getDimension(this.dimId) as unknown as { clock?: unknown }).clock,
      () => (world.getDimension(this.dimId) as unknown as { getClock?: () => unknown }).getClock?.(),
      () => (world as unknown as { getClock?: (n: string) => unknown }).getClock?.(this.time.clockId),
    ];
    for (const get of getters) {
      try {
        const clock = get() as WorldClockLike | undefined;
        if (!clock) continue;
        if (String(clock.name ?? "").startsWith("minecraft:")) continue;
        return clock;
      } catch {}
    }
    return undefined;
  }

  /** Command result check: a command that "ran" but did nothing (successCount 0) is a failure. */
  private succeeded(result: unknown): boolean {
    const n = (result as { successCount?: number } | undefined)?.successCount;
    return n === undefined || n > 0;
  }

  private lastNightTick = -1000;
  /** Last result of each effect, for /scriptevent paleforest:fx */
  readonly diag: { time: string; cycle: string; fog: string } = { time: "never applied", cycle: "never applied", fog: "never applied" };

  applyNight(): boolean {
    this.lastNightTick = system.currentTick;
    const clock = this.getClock();
    if (clock) {
      try { clock.time = this.time.timeTicks; clock.isPaused = true; return true; } catch {}
    }
    if (!this.time.fallbackToGlobalTime) return false;

    // Older API versions have no per-dimension clock: use the global time while
    // somebody is inside the dimension (restored by clearNightIfEmpty).
    const timeOk = this.setGlobalTime(this.time.timeTicks);
    const frozen = this.setDayCycle(false);
    if (frozen) this.legacyGlobalTime = true;
    return timeOk && frozen;
  }

  /** Time of day: scripting API first, command as a fallback. */
  private setGlobalTime(ticks: number): boolean {
    try {
      const w = world as unknown as { setTimeOfDay?: (t: number) => void };
      if (typeof w.setTimeOfDay === "function") { w.setTimeOfDay(ticks); this.diag.time = "setTimeOfDay ok"; return true; }
    } catch (err) { this.diag.time = `setTimeOfDay failed: ${String((err as Error)?.message ?? err)}`; }
    try {
      const d = world.getDimension(this.dimId);
      if (this.succeeded(d.runCommand(`time set ${ticks}`))) { this.diag.time = "time set (dimension) ok"; return true; }
    } catch (err) { this.diag.time = `time set (dimension) failed: ${String((err as Error)?.message ?? err)}`; }
    const ok = this.globalCommand(`time set ${ticks}`);
    this.diag.time = ok ? "time set (overworld) ok" : `${this.diag.time}; time set (overworld) failed`;
    return ok;
  }

  /** Day/night cycle: gameRules API first, command as a fallback. */
  private setDayCycle(running: boolean): boolean {
    try {
      const gr = (world as unknown as { gameRules?: Record<string, unknown> }).gameRules;
      if (gr && "doDayLightCycle" in gr) { gr.doDayLightCycle = running; this.diag.cycle = "gameRules ok"; return true; }
    } catch (err) { this.diag.cycle = `gameRules failed: ${String((err as Error)?.message ?? err)}`; }
    const ok = this.globalCommand(`gamerule dodaylightcycle ${running}`);
    this.diag.cycle = ok ? "gamerule command ok" : `${this.diag.cycle}; gamerule command failed`;
    return ok;
  }

  /** Cheap periodic check (call from a loop): re-applies the night if the time drifted. */
  keepNight(): void {
    if (!this.anyoneHere() || system.currentTick - this.lastNightTick < 100) return;
    const clock = this.getClock();
    if (clock) { this.applyNight(); return; }
    try {
      const tod = (world as unknown as { getTimeOfDay?: () => number }).getTimeOfDay?.();
      if (tod === undefined || Math.abs(tod - this.time.timeTicks) > 400) this.applyNight();
      else this.lastNightTick = system.currentTick;
    } catch { this.applyNight(); }
  }

  clearNightIfEmpty(excludeKey?: string): boolean {
    if (this.anyoneHere(excludeKey)) return false;
    const clock = this.getClock();
    if (clock) { try { clock.isPaused = false; } catch {} }
    if (!this.legacyGlobalTime) return true;
    const ok = this.setDayCycle(true);
    if (ok) this.legacyGlobalTime = false;
    return ok;
  }

  anyoneHere(excludeKey?: string): boolean {
    for (const p of world.getPlayers()) {
      try {
        if (excludeKey !== undefined && playerKey(p) === excludeKey) continue;
        if (p.dimension.id === this.dimId) return true;
      } catch {}
    }
    return false;
  }

  private globalCommand(cmd: string): boolean {
    try { return this.succeeded(world.getDimension("minecraft:overworld").runCommand(cmd)); } catch {}
    try { return this.succeeded(world.getDimension("overworld").runCommand(cmd)); } catch { return false; }
  }

  /** Re-applies night and fog a few times after arriving (the client may reset them on the dimension change). */
  refreshLighting(player: Player): void {
    for (const delay of LIGHTING_REFRESH_DELAYS) {
      system.runTimeout(() => {
        try { if (this.isHere(player)) { this.applyNight(); this.forceFog(player); } } catch {}
      }, delay);
    }
  }

  // ---- fog -------------------------------------------------------------------

  private runCmd(player: Player, command: string): boolean {
    let error = "";
    try {
      const p = player as unknown as { runCommand?: (c: string) => unknown };
      if (typeof p.runCommand === "function") {
        const ok = this.succeeded(p.runCommand(command));
        if (ok) return true;
        error = "command ran but did nothing (successCount 0)";
      }
    } catch (err) { error = String((err as Error)?.message ?? err); }
    try {
      if (this.succeeded(player.dimension.runCommand(command.replace(/@s/g, `"${player.nameTag || player.name}"`)))) return true;
    } catch (err) { error = `${error}; ${String((err as Error)?.message ?? err)}`; }
    this.lastCmdError = error;
    return false;
  }

  private lastCmdError = "";

  applyFog(player: Player): void {
    const k = playerKey(player);
    if (this.fogged.has(k) || !this.isHere(player)) return;
    if (this.runCmd(player, `fog @s push ${this.dim.fogId} ${this.dim.fogLayerId}`)) this.fogged.add(k);
  }

  /** Removes and pushes the fog layer again (never stacks). */
  forceFog(player: Player): void {
    if (!this.isHere(player)) return;
    const k = playerKey(player);
    this.runCmd(player, `fog @s remove ${this.dim.fogLayerId}`);
    this.fogged.delete(k);
    if (this.runCmd(player, `fog @s push ${this.dim.fogId} ${this.dim.fogLayerId}`)) { this.fogged.add(k); this.diag.fog = "push ok"; }
    else this.diag.fog = `push failed: ${this.lastCmdError}`;
  }

  clearFog(player: Player): void {
    const k = playerKey(player);
    if (!this.fogged.has(k)) return;
    this.runCmd(player, `fog @s remove ${this.dim.fogLayerId}`);
    this.fogged.delete(k);
  }

  // ---- music -------------------------------------------------------------------

  private stopNow(player: Player): void {
    try { (player as unknown as { stopMusic?: () => void }).stopMusic?.(); } catch {}
    try { (player as unknown as { runCommand?: (c: string) => unknown }).runCommand?.("music stop"); } catch {}
  }

  private applyMusic(player: Player, stopBefore: boolean): void {
    const k = playerKey(player);
    if (!this.music.enabled || this.playing.has(k) || !this.isHere(player) || this.holding.has(k)) return;
    if (stopBefore) this.stopNow(player);
    try {
      (player as unknown as { playMusic(id: string, o: unknown): void })
        .playMusic(this.music.trackId, { loop: this.music.loop, fade: this.music.fade, volume: this.music.volume });
      this.playing.add(k);
      this.pending.delete(k);
    } catch {}
  }

  clearMusic(player: Player): void {
    const k = playerKey(player);
    const had = this.playing.has(k) || this.pending.has(k);
    this.pending.delete(k);
    this.playing.delete(k);
    if (had) this.stopNow(player);
  }

  scheduleMusic(player: Player): void {
    if (!this.music.enabled) return;
    const k = playerKey(player);
    this.pending.add(k);

    system.runTimeout(() => {
      try { if (this.pending.has(k) && this.isHere(player) && !this.holding.has(k)) this.stopNow(player); } catch {}
    }, this.music.stopDelayTicks);

    const attempt = (fallback: boolean): void => {
      try {
        if (!this.pending.has(k)) return;
        if (!this.isHere(player) || this.holding.has(k)) { if (!this.holding.has(k)) this.pending.delete(k); return; }
        if (this.playing.has(k)) { this.pending.delete(k); return; }
        this.applyMusic(player, fallback);
      } catch {}
    };
    system.runTimeout(() => attempt(false), this.music.primaryDelayTicks);
    system.runTimeout(() => attempt(true), this.music.fallbackDelayTicks);
  }

  // ---- player lifecycle -------------------------------------------------

  onEnter(player: Player): void {
    this.forceFog(player);
    this.applyNight();
    this.refreshLighting(player);
    this.clearMusic(player);
    this.scheduleMusic(player);
  }

  onLeave(player: Player): void {
    this.clearFog(player);
    this.clearMusic(player);
    this.holding.delete(playerKey(player));
  }

  /** Removes everything if the player is no longer in the dimension (periodic sweep). */
  sweep(player: Player): void {
    if (this.isHere(player)) { this.applyFog(player); return; }
    this.onLeave(player);
  }
}
