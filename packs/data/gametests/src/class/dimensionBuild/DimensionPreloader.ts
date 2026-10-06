import { system, world } from "@minecraft/server";
import type { Dimension } from "@minecraft/server";
import { logError } from "./log";
import type { PreloadJson } from "./types";
import type { PaleForestTerrain } from "./PaleForestTerrain";

// ===========================================================================
// DimensionPreloader — ticking-area grid + spiral/ring loading
//
// The perimeter (radius, in blocks) is divided into a GRID of square sectors
// (sectorChunks x sectorChunks chunks). Every sector gets its own ticking area
// (`batch` sectors at a time, 1 = strictly sequential) so the engine loads its
// chunks, and the sector is fully generated — terrain, caves, lava, blocks and
// trees — before the next sector starts. Sectors are visited in a spiral (one
// continuous spiral outward), in rings, or in glued strips.
//
// Execution:
//  • while the loading screen is up (core not ready) the generator is pumped
//    from a runInterval with a per-tick time budget (fast);
//  • once the core is ready, the very same generator continues through
//    system.runJob (gentle) until `radius` is covered.
// ===========================================================================

export interface PreloadProgress {
  totalCells: number;
  doneCells: number;
  coreTotal: number;
  coreDone: number;
  /** true once the `holdRadius` area is ready */
  coreReady: boolean;
  finished: boolean;
  cancelled: boolean;
  /** cells that could not be loaded (no ticking area available) */
  skipped: number;
  radius: number;
}

export interface PreloadHandle {
  readonly progress: PreloadProgress;
  cancel(): void;
}

interface CellRef { cx: number; cz: number; core: boolean }
interface Sector { sx: number; sz: number; x0: number; z0: number; x1: number; z1: number; cells: CellRef[] }

type Tick = void | "wait";

interface JobState {
  owner: string;
  pumpId: number;
  jobId: number;
  areaId: string;
  /** number of ticking areas currently held (areaId + index) */
  areasHeld: number;
  cancelled: boolean;
  progress: PreloadProgress;
}

interface TickingAreaManagerLike {
  createTickingArea(id: string, options: unknown): Promise<unknown>;
  removeTickingArea?(id: string): void;
}

export class DimensionPreloader {
  private readonly jobs = new Map<string, JobState>();

  constructor(private readonly terrain: PaleForestTerrain, private readonly cfg: PreloadJson) {}

  /** Starts (or restarts) the preload for `owner`, centered on (x, z) of the dimension. */
  start(
    owner: string, centerX: number, centerZ: number, radius: number = this.cfg.radius, background = false,
  ): PreloadHandle | undefined {
    if (!this.cfg.enabled) return undefined;
    this.cancel(owner);

    const sectors = this.buildSectors(centerX, centerZ, radius);
    const allCells = sectors.flatMap((sec) => sec.cells);
    const progress: PreloadProgress = {
      totalCells: allCells.length,
      doneCells: 0,
      coreTotal: allCells.filter((c) => c.core).length,
      coreDone: 0,
      coreReady: false,
      finished: false,
      cancelled: false,
      skipped: 0,
      radius,
    };
    const state: JobState = {
      owner,
      pumpId: -1,
      jobId: -1,
      areaId: `${this.cfg.tickingAreaPrefix}${owner.replace(/[^A-Za-z0-9_]/g, "")}`,
      areasHeld: 0,
      cancelled: false,
      progress,
    };
    this.jobs.set(owner, state);

    const gen = this.run(state, sectors);
    if (background) state.jobId = system.runJob(this.resume(gen)); // gentle: no loading screen involved
    else this.pump(state, gen);
    return { progress, cancel: () => this.cancel(owner) };
  }

  get(owner: string): PreloadProgress | undefined { return this.jobs.get(owner)?.progress; }

  cancel(owner: string): void {
    const state = this.jobs.get(owner);
    if (!state) return;
    state.cancelled = true;
    state.progress.cancelled = true;
    try { if (state.pumpId >= 0) system.clearRun(state.pumpId); } catch {}
    try { if (state.jobId >= 0) system.clearJob(state.jobId); } catch {}
    this.releaseArea(state);
    this.jobs.delete(owner);
  }

  cancelAll(): void { for (const owner of [...this.jobs.keys()]) this.cancel(owner); }

  // -------------------------------------------------------------------------

  /** Phase 1: fast pump (loading screen). Phase 2: system.runJob. */
  private pump(state: JobState, gen: Generator<Tick, void, void>): void {
    const budget = Math.max(1, this.cfg.loadingBudgetMs);
    const toBackground = (): void => {
      if (state.pumpId >= 0) { try { system.clearRun(state.pumpId); } catch {} state.pumpId = -1; }
      if (state.cancelled || state.progress.finished) return;
      state.jobId = system.runJob(this.resume(gen));
    };

    state.pumpId = system.runInterval(() => {
      if (state.cancelled) return;
      const t0 = Date.now();
      while (Date.now() - t0 < budget) {
        let step: IteratorResult<Tick, void>;
        try { step = gen.next(); } catch (err) { logError("preload pump", err); state.progress.finished = true; state.progress.coreReady = true; toBackground(); return; }
        if (step.done) { state.pumpId >= 0 && system.clearRun(state.pumpId); state.pumpId = -1; return; }
        if (state.progress.coreReady) { toBackground(); return; }
        if (step.value === "wait") break; // waiting for a ticking area: resume next tick
      }
    }, 1);
  }

  private *resume(gen: Generator<Tick, void, void>): Generator<void, void, void> {
    for (;;) {
      let step: IteratorResult<Tick, void>;
      try { step = gen.next(); } catch (err) { logError("preload job", err); this.jobFailed(gen); return; }
      if (step.done) return;
      yield;
    }
  }

  private jobFailed(_gen: Generator<Tick, void, void>): void {
    for (const state of this.jobs.values()) {
      if (!state.progress.finished) { state.progress.coreReady = true; state.progress.finished = true; }
    }
  }

  /**
   * Splits the circle into the sector grid. Every cell inside the radius belongs
   * to the sector that contains its center. Sectors are returned in visiting order.
   */
  private buildSectors(centerX: number, centerZ: number, radius: number): Sector[] {
    const cellX = this.terrain.cellX, cellZ = this.terrain.cellZ;
    const size = Math.max(1, this.cfg.grid.sectorChunks) * 16;
    const map = new Map<string, Sector>();

    const cx0 = Math.floor((centerX - radius) / cellX), cx1 = Math.floor((centerX + radius) / cellX);
    const cz0 = Math.floor((centerZ - radius) / cellZ), cz1 = Math.floor((centerZ + radius) / cellZ);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const mx = (cx + 0.5) * cellX, mz = (cz + 0.5) * cellZ;
        const d = Math.hypot(mx - centerX, mz - centerZ);
        if (d > radius) continue;
        const sx = Math.floor(mx / size), sz = Math.floor(mz / size);
        const key = `${sx},${sz}`;
        let sector = map.get(key);
        if (!sector) {
          sector = { sx, sz, x0: sx * size, z0: sz * size, x1: sx * size + size - 1, z1: sz * size + size - 1, cells: [] };
          map.set(key, sector);
        }
        sector.cells.push({ cx, cz, core: d <= this.cfg.holdRadius });
      }
    }

    // inside a sector: nearest cells first
    for (const sec of map.values()) {
      sec.cells.sort((u, v) =>
        Math.hypot((u.cx + 0.5) * cellX - centerX, (u.cz + 0.5) * cellZ - centerZ) -
        Math.hypot((v.cx + 0.5) * cellX - centerX, (v.cz + 0.5) * cellZ - centerZ));
    }

    const info = (sec: Sector): { d: number; a: number } => {
      const dx = sec.x0 + size / 2 - centerX, dz = sec.z0 + size / 2 - centerZ;
      return { d: Math.hypot(dx, dz) / size, a: (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) };
    };
    const list = [...map.values()];
    switch (this.cfg.grid.order) {
      case "strips": list.sort((u, v) => u.sx - v.sx || u.sz - v.sz); break;
      case "rings": list.sort((u, v) => { const a = info(u), b = info(v); return Math.floor(a.d) - Math.floor(b.d) || a.a - b.a; }); break;
      default: list.sort((u, v) => { const a = info(u), b = info(v); return a.d + a.a - (b.d + b.a); }); // spiral
    }
    return list;
  }

  private *run(state: JobState, sectors: Sector[]): Generator<Tick, void, void> {
    const p = state.progress;
    let dim: Dimension;
    try { dim = world.getDimension(this.terrain.dimensionId); } catch { p.finished = true; p.coreReady = true; return; }

    if (p.coreTotal === 0) p.coreReady = true;
    const batch = Math.max(1, this.cfg.grid.batch);
    const margin = this.terrain.featureMargin; // trees / moss reach outside their sector

    for (let i = 0; i < sectors.length && !state.cancelled; i += batch) {
      const group = sectors.slice(i, i + batch);

      // 1) ticking areas for the whole batch (sequential when batch = 1)
      const boxes = group.map((sec) => ({
        x0: sec.x0 - margin, z0: sec.z0 - margin, x1: sec.x1 + margin, z1: sec.z1 + margin,
      }));
      const loaded: boolean = yield* this.ensureLoaded(state, dim, boxes);

      // 2) generate, sector by sector and cell by cell
      for (const sec of group) {
        if (state.cancelled) break;
        // phase A: terrain, caves, lava, blocks (trees deferred)
        for (const c of sec.cells) {
          if (state.cancelled) break;
          if (loaded && this.terrain.cellNeedsGeneration(dim, c.cx, c.cz)) yield* this.terrain.generateCellSteps(dim, c.cx, c.cz, true);
          yield;
        }
        // phase B: trees, once every cell of the sector exists and the area (with margin) is loaded
        for (const c of sec.cells) {
          if (state.cancelled) break;
          if (loaded) yield* this.terrain.placeDeferredTrees(dim, c.cx, c.cz);
          if (!loaded) p.skipped++;
          p.doneCells++;
          if (c.core) {
            p.coreDone++;
            if (p.coreDone >= p.coreTotal) p.coreReady = true;
          }
          yield;
        }
      }
      this.releaseArea(state);
    }

    p.coreReady = true;
    p.finished = true;
    this.releaseArea(state);
  }

  private isLoaded(dim: Dimension, x0: number, z0: number, x1: number, z1: number): boolean {
    const mx = (x0 + x1) >> 1, mz = (z0 + z1) >> 1;
    const probes = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [mx, mz]];
    for (const [x, z] of probes) {
      try { if (!dim.getBlock({ x, y: 64, z })) return false; } catch { return false; }
    }
    return true;
  }

  private manager(): TickingAreaManagerLike | undefined {
    return (world as unknown as { tickingAreaManager?: TickingAreaManagerLike }).tickingAreaManager;
  }

  private areaName(state: JobState, index: number): string { return `${state.areaId}_${index}`; }

  /**
   * Creates one ticking area per box (all requested together = a "block") and
   * waits for them per TICK (promises only resolve between ticks).
   * Boxes whose chunks are already loaded (e.g. next to the player) need none.
   */
  private *ensureLoaded(
    state: JobState, dim: Dimension, boxes: Array<{ x0: number; z0: number; x1: number; z1: number }>,
  ): Generator<Tick, boolean, void> {
    const pending = boxes.filter((b) => !this.isLoaded(dim, b.x0, b.z0, b.x1, b.z1));
    if (pending.length === 0) return true;
    const mgr = this.manager();
    if (!mgr) return false;

    this.releaseArea(state);
    const status = pending.map(() => ({ v: "pending" as "pending" | "ok" | "fail" }));
    pending.forEach((b, i) => {
      try {
        const promise = mgr.createTickingArea(this.areaName(state, i), {
          dimension: dim, from: { x: b.x0, y: 0, z: b.z0 }, to: { x: b.x1, y: 0, z: b.z1 },
        });
        state.areasHeld = Math.max(state.areasHeld, i + 1);
        Promise.resolve(promise).then(() => { status[i].v = "ok"; }).catch(() => { status[i].v = "fail"; });
      } catch {
        status[i].v = "fail";
      }
    });

    const startTick = system.currentTick;
    while (
      status.some((s) => s.v === "pending") && !state.cancelled &&
      system.currentTick - startTick < this.cfg.tickingAreaWaitTicks
    ) yield "wait";

    return pending.every((b) => this.isLoaded(dim, b.x0, b.z0, b.x1, b.z1));
  }

  private releaseArea(state: JobState): void {
    const mgr = this.manager();
    for (let i = 0; i < state.areasHeld; i++) {
      try { mgr?.removeTickingArea?.(this.areaName(state, i)); } catch {}
    }
    state.areasHeld = 0;
  }
}
