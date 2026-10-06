import { BlockPermutation, BlockVolume, system, world } from "@minecraft/server";
import type {
  BlockFillOptions, Dimension, Player } from "@minecraft/server";
import type {
  BiomeJson, CellCoords, LavaPoolJson, OresJson, ShrineJson, StarterLanding, TerrainData, TreeJson, Vec2, Vec3,
} from "./types";

// ===========================================================================
// PaleForestTerrain
// Terrain generator using thin SLICES (cellX x cellZ, long on the Z axis), data-driven
// (JSON). Knows nothing about doors, items, music, etc. — that lives in main.
// Dimension = Overworld * coordinateScale.
// ===========================================================================

export interface TerrainOptions {
  dimensionId: string;
  /** dimension coordinates = Overworld coordinates * coordinateScale */
  coordinateScale: number;
  data: TerrainData;
}

interface CaveSphere { x: number; y: number; z: number; r: number }
interface CaveOpening { x: number; z: number; topY: number; yaw: number; seed: number; topRadius: number; bottomRadius: number; length: number }
interface CaveRavine { x: number; z: number; topY: number; yaw: number; seed: number; length: number; width: number }
interface LavaSpot { x: number; z: number; seed: number; structure: string }
interface TreeSpot { x: number; z: number; seed: number; structure: string }

export interface CellPlan {
  cx: number; cz: number;
  caveSpheres: CaveSphere[]; caveOpenings: CaveOpening[]; caveRavines: CaveRavine[];
  lavaSpots: LavaSpot[]; treeSpots: TreeSpot[];
}

export type CellSteps = Generator<void, boolean, void>;
interface ActiveTask { cx: number; cz: number; key: string; gen?: CellSteps }
interface StreamState { x: number; z: number; r: number; list: CellCoords[]; idx: number }
interface RegionFeatures { lava: LavaSpot[]; trees: TreeSpot[] }
export interface ShrineRecord { x: number; z: number; r: number }

export class PaleForestTerrain {
  readonly dimensionId: string;
  readonly coordinateScale: number;
  readonly cellX: number;
  readonly cellZ: number;
  readonly maxSurfaceY: number;

  private readonly d: TerrainData;
  private readonly b: Record<string, string>;
  private readonly floorY: number;
  private readonly carveFloorY: number;
  private readonly airId: string;
  private readonly carveFilter: BlockFillOptions;
  private readonly surfaceIds = new Set<string>();
  private readonly overlayIds = new Set<string>();
  private readonly attachIds = new Set<string>();
  private readonly plantsByBiome = new Map<string, Array<{ id: string; above: number }>>();
  private readonly permCache = new Map<string, BlockPermutation | undefined>();

  private seed = 0;
  private seedFx = 0;
  private seedReady = false;

  private readonly topYCache = new Map<string, number>();
  private readonly bedrockCache = new Map<string, number>();
  private readonly recent = new Set<string>();
  /** Trees whose placement was deferred (preload places them after the whole sector exists). */
  private readonly deferredTrees = new Map<string, TreeSpot[]>();
  /** How far (blocks) a structure can reach outside its cell: ticking areas must cover it. */
  readonly featureMargin: number;
  /** Ore rules with the rarest noise first, so most blocks are rejected after one noise sample. */
  private readonly oreRules: OresJson["rules"];
  private readonly queued = new Set<string>();
  private readonly active: ActiveTask[] = [];
  private readonly streams = new Map<string, StreamState>();
  private readonly regionCache = new Map<string, RegionFeatures>();
  private readonly featureRegion: number;
  private shrines: ShrineRecord[] = [];
  private loadingBoostUntil = 0;

  constructor(opts: TerrainOptions) {
    this.d = opts.data;
    this.dimensionId = opts.dimensionId;
    this.coordinateScale = opts.coordinateScale;
    this.cellX = this.d.grid.cellX;
    this.cellZ = this.d.grid.cellZ;
    this.featureRegion = Math.max(8, this.d.grid.featureRegion);
    this.b = this.d.palette.blocks;
    this.floorY = this.d.shape.bedrockFloorY;
    this.carveFloorY = this.d.shape.bedrockFloorY + this.d.shape.bedrockLayers;
    this.airId = this.id(this.d.shape.blocks.air);
    this.maxSurfaceY = this.d.shape.plainsMaxY +
      (this.d.mountains.enabled ? this.d.mountains.height + this.d.mountains.extraHeadroom : 0);
    let reach = 2;
    for (const T of Object.values(this.d.trees)) {
      for (const l of T.canopy.layers) reach = Math.max(reach, l.radius);
      reach = Math.max(reach, T.hangingMoss.radius);
    }
    this.featureMargin = reach + 2;
    this.oreRules = this.d.ores.rules.map((r) => ({ ...r, noises: [...r.noises].sort((a, b) => b.threshold - a.threshold) }));
    this.carveFilter = { blockFilter: { includeTypes: this.d.caves.carvable.map((n) => this.id(n)) } };

    for (const biome of this.d.biomes) {
      this.surfaceIds.add(this.id(biome.surface.primary));
      this.surfaceIds.add(this.id(biome.surface.secondary));
      const plants = biome.decoration.plants
        .map((p) => ({ id: this.id(p.block), above: p.above }))
        .sort((a, c) => c.above - a.above);
      this.plantsByBiome.set(biome.id, plants);
      for (const p of plants) this.overlayIds.add(p.id);
      this.overlayIds.add(this.id(biome.decoration.ceilingMoss.block));
      for (const n of biome.decoration.ceilingMoss.attachBlocks) this.attachIds.add(this.id(n));
    }
  }

  // =========================================================================
  // Public: seed, coordinates, state
  // =========================================================================

  get ready(): boolean { return this.seedReady; }

  setSeed(seed: number): void {
    this.seed = seed | 0;
    this.seedFx = ((this.seed >>> 0) % 100003) * 0.7311;
    this.topYCache.clear();
    this.bedrockCache.clear();
    this.recent.clear();
    this.regionCache.clear();
    this.seedReady = true;
  }

  getSeed(): number { return this.seed; }

  /** Overworld -> dimension */
  overworldToDimension(x: number, z: number): Vec2 {
    return { x: Math.round(x * this.coordinateScale), z: Math.round(z * this.coordinateScale) };
  }

  /** dimension -> Overworld (inverse conversion) */
  dimensionToOverworld(x: number, z: number): Vec2 {
    return { x: Math.round(x / this.coordinateScale), z: Math.round(z / this.coordinateScale) };
  }

  blockId(name: string): string { return this.id(name); }

  /** Enables "boost" mode (larger time budget) for N ticks — loading screen. */
  beginLoadingBoost(ticks: number): void { this.loadingBoostUntil = system.currentTick + ticks; }
  private get boost(): boolean { return system.currentTick < this.loadingBoostUntil; }

  get pendingWork(): boolean {
    if (this.active.length > 0) return true;
    for (const st of this.streams.values()) if (st.idx < st.list.length) return true;
    return false;
  }

  // =========================================================================
  // Public: shrines (entry points)
  // =========================================================================

  registerShrine(x: number, z: number, r: number): void {
    this.regionCache.clear();
    if (this.shrines.some((s) => s.x === x && s.z === z)) return;
    this.shrines.push({ x, z, r });
    if (this.shrines.length > 400) this.shrines.shift();
  }

  getShrines(): ShrineRecord[] { return this.shrines.map((s) => ({ ...s })); }

  /** Existing shrine within `reuseDistance` blocks of (x,z), if any. */
  findShrineNear(x: number, z: number, shrineId?: string): Vec2 | undefined {
    const reuse = this.shrineDef(shrineId).reuseDistance;
    let best: ShrineRecord | undefined;
    let bestD = Infinity;
    for (const s of this.shrines) {
      const dist = Math.hypot(s.x - x, s.z - z);
      if (dist <= reuse && dist < bestD) { best = s; bestD = dist; }
    }
    return best ? { x: best.x, z: best.z } : undefined;
  }

  planLanding(x: number, z: number, shrineId?: string): StarterLanding {
    const top = this.topYAt(x, z);
    return { x: x + 0.5, y: top + 1 + this.shrineDef(shrineId).teleportBufferY, z: z + 0.5, groundY: top + 1 };
  }

  /** Builds the shrine (platform, fence and return door) centered on (x,z). */
  buildShrine(dimension: Dimension, x: number, z: number, shrineId?: string): StarterLanding {
    const sh = this.shrineDef(shrineId);
    const r = sh.radius;
    this.ensureTerrainBox(dimension, x - r - 1, z - r - 1, x + r + 1, z + r + 1);

    const floor = this.id(sh.blocks.floor);
    const fence = this.id(sh.blocks.fence);
    const air = this.id(sh.blocks.air);
    const platformY = this.topYAt(x, z) + 1;

    for (let px = x - r; px <= x + r; px++) {
      for (let pz = z - r; pz <= z + r; pz++) {
        const localTop = this.topYAt(px, pz);
        const supportTop = Math.min(localTop + 1, platformY);
        this.fillColumnRun(dimension, px, pz, supportTop, platformY, floor);
        this.fillColumnRun(dimension, px, pz, platformY + 1, platformY + sh.clearHeight, air);
      }
    }
    for (let pz = z - r; pz <= z + r; pz++) {
      this.setBlockType(dimension, { x: x - r, y: platformY + 1, z: pz }, fence);
      this.setBlockType(dimension, { x: x + r, y: platformY + 1, z: pz }, fence);
    }
    for (let px = x - r + 1; px <= x + r - 1; px++) {
      this.setBlockType(dimension, { x: px, y: platformY + 1, z: z - r }, fence);
      this.setBlockType(dimension, { x: px, y: platformY + 1, z: z + r }, fence);
    }

    this.buildDoor(dimension, this.id(sh.blocks.door), x + sh.door.dx, platformY + 1, z + sh.door.dz);
    this.registerShrine(x, z, sh.treeExclusionRadius);
    return this.planLanding(x, z, shrineId);
  }

  /** Ensures a 3x3 pad under the arrival point (safety net). */
  ensureLandingPad(dimension: Dimension, landing: StarterLanding, shrineId?: string): void {
    const sh = this.shrineDef(shrineId);
    const floor = this.id(sh.blocks.floor);
    const cx = Math.floor(landing.x), cz = Math.floor(landing.z);
    const center = this.blockTypeId(dimension, { x: cx, y: landing.groundY, z: cz });
    if (center && center !== this.airId) return;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let z = cz - 1; z <= cz + 1; z++) {
        this.setBlockType(dimension, { x, y: landing.groundY, z }, floor);
        this.fillColumnRun(dimension, x, z, landing.groundY + 1, landing.groundY + 4, this.airId);
      }
    }
  }

  // =========================================================================
  // Public: generation
  // =========================================================================

  cellCoordsAt(x: number, z: number): CellCoords {
    return { cx: Math.floor(x / this.cellX), cz: Math.floor(z / this.cellZ) };
  }

  /** SYNCHRONOUSLY generates the slices in a rectangle (in slices) around (x,z). */
  generateAround(dimension: Dimension, x: number, z: number, rx: number, rz: number): void {
    const c = this.cellCoordsAt(x, z);
    const entries: Array<{ cx: number; cz: number; dist: number }> = [];
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dz = -rz; dz <= rz; dz++) entries.push({ cx: c.cx + dx, cz: c.cz + dz, dist: Math.hypot(dx * this.cellX, dz * this.cellZ) });
    }
    entries.sort((a, b) => a.dist - b.dist);
    for (const e of entries) {
      if (!this.queued.has(this.key(e.cx, e.cz)) && !this.cellNeedsGeneration(dimension, e.cx, e.cz)) continue;
      this.generateCellImmediate(dimension, e.cx, e.cz);
    }
  }

  /** SYNCHRONOUSLY generates every slice touching the circle of `radius` blocks around (x, z), nearest first. */
  generateRadius(dimension: Dimension, x: number, z: number, radius: number): void {
    for (const c of this.cellsInCircle(x, z, radius, false)) {
      if (!this.queued.has(this.key(c.cx, c.cz)) && !this.cellNeedsGeneration(dimension, c.cx, c.cz)) continue;
      this.generateCellImmediate(dimension, c.cx, c.cz);
    }
  }

  /** Stepwise version (for runJob): one slice, yielding execution between stages. */
  *generateCellSteps(dimension: Dimension, cx: number, cz: number, deferTrees = false): CellSteps {
    this.removeQueued(cx, cz);
    const plan = this.createPlan(cx, cz);
    if (deferTrees) this.deferredTrees.set(this.key(cx, cz), plan.treeSpots);
    const ok = yield* this.cellGen(dimension, plan, deferTrees);
    if (ok) this.recent.add(this.key(cx, cz));
    return ok;
  }

  /** Places the trees deferred by generateCellSteps(..., true). Call once the neighbours exist and are loaded. */
  *placeDeferredTrees(dimension: Dimension, cx: number, cz: number): Generator<void, boolean, void> {
    const key = this.key(cx, cz);
    const spots = this.deferredTrees.get(key);
    if (!spots) return true;
    this.deferredTrees.delete(key);
    let ok = true;
    for (const tree of spots) { ok = this.tryPlaceTree(dimension, tree) && ok; yield; }
    return ok;
  }

  generateCellImmediate(dimension: Dimension, cx: number, cz: number): boolean {
    const gen = this.generateCellSteps(dimension, cx, cz);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  cellNeedsGeneration(dimension: Dimension, cx: number, cz: number): boolean {
    if (this.recent.has(this.key(cx, cz))) return false;
    const { score, samples } = this.coverageScore(dimension, cx, cz);
    // coverageThreshold is expressed out of 15 samples; scale it to the real sample count
    return score < Math.ceil((this.d.throughput.coverageThreshold * samples) / 15);
  }

  /** Called every tick: processes the queue within a time budget. */
  tick(): void {
    this.pruneRecent();
    this.processQueue();
  }

  /**
   * Cells touching the circle of `radius` blocks around (x, z), nearest first.
   * With `skipDone` the cells already generated/queued are left out (cheap set lookups).
   */
  private cellsInCircle(x: number, z: number, radius: number, skipDone: boolean): Array<CellCoords & { d: number }> {
    const cx0 = Math.floor((x - radius) / this.cellX), cx1 = Math.floor((x + radius) / this.cellX);
    const cz0 = Math.floor((z - radius) / this.cellZ), cz1 = Math.floor((z + radius) / this.cellZ);
    const out: Array<CellCoords & { d: number }> = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      const ox = cx * this.cellX;
      const dx = Math.max(0, ox - x, x - (ox + this.cellX - 1));
      for (let cz = cz0; cz <= cz1; cz++) {
        const oz = cz * this.cellZ;
        const dz = Math.max(0, oz - z, z - (oz + this.cellZ - 1));
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        if (skipDone) { const k = this.key(cx, cz); if (this.recent.has(k) || this.queued.has(k)) continue; }
        out.push({ cx, cz, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /**
   * Streams terrain around the player inside a ROUND radius (blocks), which the
   * caller derives from the render distance. The circle is rescanned only after
   * the player moved `rescanDistance` blocks (or the radius changed) and its cells
   * are evaluated in small batches per call, so the cost per tick stays flat.
   */
  streamAroundPlayer(player: Player, radiusBlocks: number): void {
    let dimension: Dimension;
    let loc: Vec3;
    try { dimension = player.dimension; loc = player.location; } catch { return; }
    if (dimension.id !== this.dimensionId) return;

    const t = this.d.throughput;
    const key = (player as unknown as { id?: string }).id ?? player.name;
    const r = Math.max(8, radiusBlocks);
    let st = this.streams.get(key);
    if (!st || Math.hypot(loc.x - st.x, loc.z - st.z) >= t.rescanDistance || Math.abs(st.r - r) >= 1) {
      st = { x: loc.x, z: loc.z, r, list: this.cellsInCircle(loc.x, loc.z, r, true), idx: 0 };
      this.streams.set(key, st);
    }

    // 1) the rows right under / next to the player are generated first, inside a
    //    strict time box: a cell that does not finish in time keeps going from the
    //    queue (its generator is resumable), so one call can never hang the tick.
    const t0 = Date.now();
    let generated = 0;
    for (let i = st.idx; i < st.list.length && i < st.idx + 16 && generated < t.playerImmediateMaxCells; i++) {
      if (Date.now() - t0 >= t.immediateBudgetMs) break;
      const c = st.list[i];
      const k = this.key(c.cx, c.cz);
      if (this.queued.has(k) || !this.cellNeedsGeneration(dimension, c.cx, c.cz)) continue;
      this.removeQueued(c.cx, c.cz);
      const gen = this.cellGen(dimension, this.createPlan(c.cx, c.cz), false);
      let r = gen.next();
      while (!r.done && Date.now() - t0 < t.immediateBudgetMs) r = gen.next();
      if (r.done) { if (r.value) this.recent.add(k); }
      else { this.queued.add(k); this.active.unshift({ cx: c.cx, cz: c.cz, key: k, gen }); }
      generated++;
    }

    // 2) the rest of the circle goes to the queue, nearest first, in batches
    if (this.active.length >= t.maxQueued) return;
    const batch: ActiveTask[] = [];
    const end = Math.min(st.list.length, st.idx + t.scanBatch);
    for (; st.idx < end; st.idx++) {
      const c = st.list[st.idx];
      const k = this.key(c.cx, c.cz);
      if (this.recent.has(k) || this.queued.has(k)) continue;
      if (!this.cellNeedsGeneration(dimension, c.cx, c.cz)) { this.recent.add(k); continue; }
      this.queued.add(k);
      batch.push({ cx: c.cx, cz: c.cz, key: k });
    }
    // rows near the player jump the queue (kept in distance order)
    this.active.splice(0, 0, ...batch);
  }

  forgetPlayer(playerKey: string): void { this.streams.delete(playerKey); }

  // =========================================================================
  // Public: queries
  // =========================================================================

  topYAt(x: number, z: number): number {
    const key = `${x},${z}`;
    const hit = this.topYCache.get(key);
    if (hit !== undefined) return hit;

    const s = this.d.shape;
    let sum = 0;
    for (const o of s.octaves) sum += (this.valueNoise(x * o.scale, z * o.scale, o.seed) * 2 - 1) * o.amplitude;
    const plains = this.clamp(s.baseY + Math.round(sum), s.plainsMinY, s.plainsMaxY);
    const result = Math.min(this.maxSurfaceY, plains + Math.round(this.mountainHeightAt(x, z)));

    if (this.topYCache.size >= 16384) this.topYCache.clear();
    this.topYCache.set(key, result);
    return result;
  }

  columnLooksEstablished(dimension: Dimension, x: number, z: number): boolean {
    const topY = this.topYAt(x, z);
    const bed = this.blockTypeId(dimension, { x, y: this.floorY, z });
    if (!bed || bed === this.airId) return false;
    for (let y = topY; y >= topY - 6; y--) {
      const id = this.blockTypeId(dimension, { x, y, z });
      if (!id || id === this.airId || this.overlayIds.has(id)) continue;
      return true;
    }
    const extra = this.blockTypeId(dimension, { x, y: topY + 1, z });
    return !!extra && extra !== this.airId && !this.overlayIds.has(extra);
  }

  /** Ensures the basic terrain in a box (used by lava, trees and shrine). */
  ensureTerrainBox(dimension: Dimension, x0: number, z0: number, x1: number, z1: number): boolean {
    let ok = true;
    const cx0 = Math.floor(x0 / this.cellX), cx1 = Math.floor(x1 / this.cellX);
    const cz0 = Math.floor(z0 / this.cellZ), cz1 = Math.floor(z1 / this.cellZ);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const o = this.cellOrigin(cx, cz);
        const xa = Math.max(x0, o.x), xb = Math.min(x1, o.x + this.cellX - 1);
        for (let x = xa; x <= xb; x++) {
          if (this.rowSeemsEmpty(dimension, x, o.z)) ok = this.buildRowTerrain(dimension, x, o.z) && ok;
        }
      }
    }
    return ok;
  }

  // =========================================================================
  // Data / internal helpers
  // =========================================================================

  private id(name: string): string { return this.b[name] ?? name; }
  private key(cx: number, cz: number): string { return `${cx},${cz}`; }
  private cellOrigin(cx: number, cz: number): Vec2 { return { x: cx * this.cellX, z: cz * this.cellZ }; }
  private clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
  private lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }


  private shrineDef(id?: string): ShrineJson {
    const list = Object.values(this.d.shrines);
    if (id && this.d.shrines[id]) return this.d.shrines[id];
    return list[0];
  }

  /**
   * Biome lookup. Several biomes may exist; none of them needs a quota. Biomes
   * with a `selection` rule are matched by noise, anything else is the fallback
   * (the first biome without a rule, or the first biome overall). With a single
   * biome no rule is required.
   */
  private biomeAt(x: number, z: number): BiomeJson {
    const list = this.d.biomes;
    if (list.length === 1) return list[0];
    for (const biome of list) {
      const s = biome.selection;
      if (!s) continue;
      const n = this.valueNoise(x * s.scale, z * s.scale, s.seed);
      if (n >= s.min && n <= s.max) return biome;
    }
    return list.find((b) => !b.selection) ?? list[0];
  }

  // ---- seed-dependent ----
  private frac(v: number): number { return v - Math.floor(v); }
  hash2(x: number, z: number, seed = 0): number {
    return this.frac(Math.sin(x * 127.1 + z * 311.7 + seed * 74.7 + this.seedFx) * 43758.5453123);
  }
  private hash3(x: number, y: number, z: number, seed = 0): number {
    return this.frac(Math.sin(x * 157.3 + y * 269.5 + z * 331.9 + seed * 71.1 + this.seedFx) * 43758.5453123);
  }
  private fade(t: number): number { return t * t * (3 - 2 * t); }
  private smoothstep(e0: number, e1: number, v: number): number {
    const t = this.clamp((v - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private valueNoise(x: number, z: number, seed = 0): number {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const tx = this.fade(x - x0), tz = this.fade(z - z0);
    const a = this.hash2(x0, z0, seed), b = this.hash2(x0 + 1, z0, seed);
    const c = this.hash2(x0, z0 + 1, seed), d = this.hash2(x0 + 1, z0 + 1, seed);
    return this.lerp(this.lerp(a, b, tx), this.lerp(c, d, tx), tz);
  }

  private valueNoise3D(x: number, y: number, z: number, seed = 0): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const tx = this.fade(x - x0), ty = this.fade(y - y0), tz = this.fade(z - z0);
    const h = (dx: number, dy: number, dz: number): number => this.hash3(x0 + dx, y0 + dy, z0 + dz, seed);
    const x00 = this.lerp(h(0, 0, 0), h(1, 0, 0), tx), x10 = this.lerp(h(0, 1, 0), h(1, 1, 0), tx);
    const x01 = this.lerp(h(0, 0, 1), h(1, 0, 1), tx), x11 = this.lerp(h(0, 1, 1), h(1, 1, 1), tx);
    return this.lerp(this.lerp(x00, x10, ty), this.lerp(x01, x11, ty), tz);
  }

  private makeRng(seed: number): () => number {
    let state = (seed >>> 0) || 1;
    return (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  private seedFromNumbers(...values: number[]): number {
    let s = 2166136261 >>> 0;
    for (const v of values) { s ^= Math.trunc(v) >>> 0; s = Math.imul(s, 16777619) >>> 0; }
    return s >>> 0;
  }

  private highestBedrockY(x: number, z: number): number {
    const key = `${x},${z}`;
    const hit = this.bedrockCache.get(key);
    if (hit !== undefined) return hit;
    const chances = this.d.shape.bedrockChances;
    let highest = this.floorY;
    for (let layer = 1; layer < this.d.shape.bedrockLayers; layer++) {
      const y = this.floorY + layer;
      if (this.hash3(x, y, z, 901 + layer) < (chances[layer - 1] ?? 0.5)) highest = y;
    }
    if (this.bedrockCache.size >= 8192) this.bedrockCache.clear();
    this.bedrockCache.set(key, highest);
    return highest;
  }

  private mountainHeightAt(x: number, z: number): number {
    const m = this.d.mountains;
    if (!m.enabled) return 0;
    const dist = Math.hypot(x - m.clearCenter.x, z - m.clearCenter.z);
    const clear = this.smoothstep(m.clearInner, m.clearOuter, dist);
    if (clear <= 0) return 0;

    const f = m.frequency;
    const region = this.valueNoise(x * f + m.regionOffset[0], z * f + m.regionOffset[1], m.regionSeed);
    const mask = this.smoothstep(m.coverage, m.coverage + m.blendWidth, region);
    if (mask <= 0) return 0;

    const ridge = 1 - Math.abs(this.valueNoise(x * f * m.ridgeFrequencyMul, z * f * m.ridgeFrequencyMul, m.ridgeSeed) * 2 - 1);
    const peaks = Math.pow(ridge, m.ridgePower);
    let h = (m.baseBody + peaks * (1 - m.baseBody)) * m.height;
    for (const r of m.rough) h += (this.valueNoise(x * r.scale, z * r.scale, r.seed) * 2 - 1) * r.amplitude;
    return Math.max(0, h) * mask * clear;
  }

  private surfaceBlockFor(biome: BiomeJson, x: number, z: number, topY: number): string {
    const s = biome.surface;
    const rock = s.rockLineY;
    if (topY >= rock) return this.id(s.rockBlock);
    if (topY >= rock - s.rockBlendBlocks && this.hash2(x, z, 97) < (topY - (rock - s.rockBlendBlocks)) / s.rockBlendBlocks) {
      return this.id(s.rockBlock);
    }
    return this.hash2(x, z, 91) > 1 - s.primaryChance ? this.id(s.primary) : this.id(s.secondary);
  }

  // ---- blocks ----
  private setBlockType(dimension: Dimension, loc: Vec3, typeId: string): boolean {
    try { dimension.setBlockType(loc, typeId); return true; } catch { return false; }
  }
  private setBlockPerm(dimension: Dimension, loc: Vec3, perm: BlockPermutation): boolean {
    try { dimension.setBlockPermutation(loc, perm); return true; } catch { return false; }
  }
  private blockTypeId(dimension: Dimension, loc: Vec3): string | undefined {
    try { return dimension.getBlock(loc)?.typeId; } catch { return undefined; }
  }

  private perm(typeId: string, states: Record<string, string | number | boolean>): BlockPermutation | undefined {
    const key = typeId + JSON.stringify(states);
    if (this.permCache.has(key)) return this.permCache.get(key);
    let perm: BlockPermutation | undefined;
    try { perm = BlockPermutation.resolve(typeId, states); } catch { perm = undefined; }
    this.permCache.set(key, perm);
    return perm;
  }

  private fillColumnRun(dimension: Dimension, x: number, z: number, y1: number, y2: number, typeId: string): boolean {
    if (y2 < y1) return true;
    if (y1 === y2) return this.setBlockType(dimension, { x, y: y1, z }, typeId);
    try {
      dimension.fillBlocks(new BlockVolume({ x, y: y1, z }, { x, y: y2, z }), typeId);
      return true;
    } catch {
      let ok = true;
      for (let y = y1; y <= y2; y++) ok = this.setBlockType(dimension, { x, y, z }, typeId) && ok;
      return ok;
    }
  }

  /** Row along Z (fixed x) using ONE fillBlocks call. */
  private fillRowZ(
    dimension: Dimension, x: number, z0: number, z1: number, y1: number, y2: number,
    typeId: string, options?: BlockFillOptions,
  ): boolean {
    if (y2 < y1) return true;
    try {
      dimension.fillBlocks(new BlockVolume({ x, y: y1, z: z0 }, { x, y: y2, z: z1 }), typeId, options);
      return true;
    } catch { return false; }
  }

  private buildDoor(dimension: Dimension, doorId: string, x: number, y: number, z: number): void {
    const variants = (upper: boolean): Array<Record<string, boolean | number | string>> => {
      const base = { door_hinge_bit: false, open_bit: false, upper_block_bit: upper };
      return [{ ...base, "minecraft:cardinal_direction": "north" }, { ...base, direction: 0 }, { ...base }];
    };
    const resolve = (upper: boolean): BlockPermutation | undefined => {
      for (const states of variants(upper)) {
        const p = this.perm(doorId, states);
        if (p) return p;
      }
      return undefined;
    };
    const lower = resolve(false), upper = resolve(true);
    if (lower && upper) {
      const a = this.setBlockPerm(dimension, { x, y, z }, lower);
      const b = this.setBlockPerm(dimension, { x, y: y + 1, z }, upper);
      if (a && b) return;
    }
    try {
      const short = doorId.replace("minecraft:", "");
      dimension.runCommand(`setblock ${x} ${y} ${z} ${short} ["direction"=0,"door_hinge_bit"=false,"open_bit"=false,"upper_block_bit"=false]`);
      dimension.runCommand(`setblock ${x} ${y + 1} ${z} ${short} ["direction"=0,"door_hinge_bit"=false,"open_bit"=false,"upper_block_bit"=true]`);
    } catch {}
  }

  // =========================================================================
  // Caves
  // =========================================================================

  private sphereTouchesCell(s: CaveSphere, cx: number, cz: number): boolean {
    const o = this.cellOrigin(cx, cz);
    return s.x + s.r >= o.x && s.x - s.r <= o.x + this.cellX - 1 &&
           s.z + s.r >= o.z && s.z - s.r <= o.z + this.cellZ - 1;
  }

  private walkCave(
    out: CaveSphere[], cx: number, cz: number,
    sx: number, sy: number, sz: number, yaw: number, pitch: number,
    length: number, baseRadius: number, seed: number, depth = 0,
  ): void {
    const c = this.d.caves;
    const rng = this.makeRng(seed);
    let x = sx, y = sy, z = sz, yawVel = 0, pitchVel = 0;

    for (let i = 0; i < length; i++) {
      const progress = i / Math.max(1, length - 1);
      const radius = baseRadius * (0.78 + Math.sin(progress * Math.PI) * 0.55 + rng() * 0.18);
      const sphere: CaveSphere = { x, y, z, r: radius };
      if (sphere.y - sphere.r > this.carveFloorY && this.sphereTouchesCell(sphere, cx, cz)) out.push(sphere);

      const topY = this.topYAt(Math.floor(x), Math.floor(z));
      const minY = this.carveFloorY + 4;
      const maxY = topY - 1;

      if (depth < 1 && i > 4 && i < length - 5 && rng() < c.branchChance) {
        const bYaw = yaw + (rng() > 0.5 ? 1 : -1) * (0.7 + rng() * 0.65);
        const bPitch = pitch * 0.6 + (rng() - 0.5) * 0.18;
        const bLen = Math.max(6, Math.floor(length * (0.38 + rng() * 0.28)));
        const bRad = Math.max(1.7, baseRadius * (0.72 + rng() * 0.18));
        this.walkCave(out, cx, cz, x, y, z, bYaw, bPitch, bLen, bRad, this.seedFromNumbers(seed, i, depth, 977), depth + 1);
      }

      x += Math.cos(yaw) * Math.cos(pitch) * 1.8;
      z += Math.sin(yaw) * Math.cos(pitch) * 1.8;
      y += Math.sin(pitch) * 1.28;
      yawVel = yawVel * 0.72 + (rng() - 0.5) * 0.14;
      pitchVel = pitchVel * 0.62 + (rng() - 0.5) * 0.07;
      yaw += yawVel;
      pitch = this.clamp(pitch + pitchVel, -0.74, 0.74);

      if (y < minY + 1) { y = minY + 1; pitch = Math.abs(pitch) * 0.65 + 0.08; }
      else if (y > maxY + 1) { y = maxY + 1; pitch = -Math.abs(pitch) * 0.7 - 0.06; }
    }
  }

  private collectCaves(cx: number, cz: number): Pick<CellPlan, "caveSpheres" | "caveOpenings" | "caveRavines"> {
    const c = this.d.caves;
    const spheres: CaveSphere[] = [], openings: CaveOpening[] = [], ravines: CaveRavine[] = [];
    const o = this.cellOrigin(cx, cz);
    const minX = Math.floor((o.x - c.margin) / c.cellSize), maxX = Math.floor((o.x + this.cellX - 1 + c.margin) / c.cellSize);
    const minZ = Math.floor((o.z - c.margin) / c.cellSize), maxZ = Math.floor((o.z + this.cellZ - 1 + c.margin) / c.cellSize);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gz = minZ; gz <= maxZ; gz++) {
        const cellSeed = this.seedFromNumbers(this.seed, gx, gz, 1409);
        const rng = this.makeRng(cellSeed);
        if (rng() > c.systemChance) continue;

        const count = 1 + (rng() < c.extraSystemChance ? 1 : 0);
        const wx = gx * c.cellSize + c.cellSize * 0.5;
        const wz = gz * c.cellSize + c.cellSize * 0.5;

        for (let si = 0; si < count; si++) {
          const sSeed = this.seedFromNumbers(cellSeed, si, 1433);
          const r = this.makeRng(sSeed);
          const startX = wx + (r() - 0.5) * (c.cellSize * 0.8);
          const startZ = wz + (r() - 0.5) * (c.cellSize * 0.8);
          const localTop = this.topYAt(Math.floor(startX), Math.floor(startZ));
          const surfaceMode = r() < c.surfaceSystemChance;
          const startY = surfaceMode
            ? localTop - (1 + Math.floor(r() * 3))
            : this.carveFloorY + 8 + Math.floor(r() * Math.max(8, localTop - this.carveFloorY - 18));
          const yaw = r() * Math.PI * 2;
          const pitch = surfaceMode ? (r() - 0.4) * 0.34 : (r() - 0.5) * 0.22;
          const length = c.minStepLength + Math.floor(r() * (c.maxStepLength - c.minStepLength + 1));
          const baseRadius = surfaceMode ? 2.6 + r() * 1.25 : 1.9 + r() * 0.95;

          this.walkCave(spheres, cx, cz, startX, startY, startZ, yaw, pitch, length, baseRadius, sSeed, 0);

          if (surfaceMode && r() < c.surfaceOpeningChance) {
            const len = c.openingLengthMin + Math.floor(r() * (c.openingLengthMax - c.openingLengthMin + 1));
            openings.push({ x: startX, z: startZ, topY: localTop, yaw, seed: sSeed,
              topRadius: 2.3 + r() * 1.4, bottomRadius: 1.4 + r() * 0.9, length: len });
          }
          if (surfaceMode && r() < c.ravineChance) {
            ravines.push({ x: startX + (r() - 0.5) * 5, z: startZ + (r() - 0.5) * 5, topY: localTop,
              yaw: yaw + (r() - 0.5) * 0.7, seed: this.seedFromNumbers(sSeed, 4001),
              length: 8 + Math.floor(r() * 8), width: 2.2 + r() * 1.5 });
          }
        }
      }
    }
    return { caveSpheres: spheres, caveOpenings: openings, caveRavines: ravines };
  }

  private carveSpan(dimension: Dimension, x: number, z: number, yLo: number, yHi: number): boolean {
    if (yHi < yLo) return true;
    try {
      dimension.fillBlocks(new BlockVolume({ x, y: yLo, z }, { x, y: yHi, z }), this.airId, this.carveFilter);
      return true;
    } catch { return false; }
  }

  private carveEllipsoid(
    dimension: Dimension, cx: number, cz: number,
    ex: number, ey: number, ez: number, radiusXZ: number, radiusY: number,
  ): boolean {
    let ok = true;
    const o = this.cellOrigin(cx, cz);
    const minX = Math.max(o.x, Math.floor(ex - radiusXZ)), maxX = Math.min(o.x + this.cellX - 1, Math.ceil(ex + radiusXZ));
    const minZ = Math.max(o.z, Math.floor(ez - radiusXZ)), maxZ = Math.min(o.z + this.cellZ - 1, Math.ceil(ez + radiusXZ));
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const nx = (x + 0.5 - ex) / radiusXZ, nz = (z + 0.5 - ez) / radiusXZ;
        const h2 = nx * nx + nz * nz;
        if (h2 > 1) continue;
        const half = radiusY * Math.sqrt(1 - h2);
        const yLo = Math.max(this.carveFloorY, this.highestBedrockY(x, z) + 1, Math.ceil(ey - half - 0.5));
        const yHi = Math.min(this.maxSurfaceY + 2, Math.floor(ey + half - 0.5));
        ok = this.carveSpan(dimension, x, z, yLo, yHi) && ok;
      }
    }
    return ok;
  }

  private carveOpening(dimension: Dimension, op: CaveOpening, cx: number, cz: number): boolean {
    let ok = true;
    for (let i = 0; i < op.length; i++) {
      const p = i / Math.max(1, op.length - 1);
      const x = op.x + Math.cos(op.yaw) * i * 1.4, z = op.z + Math.sin(op.yaw) * i * 1.4;
      const y = op.topY - p * (3.0 + op.bottomRadius * 1.8);
      const rXZ = this.lerp(op.topRadius, op.bottomRadius, p) * (1.0 + Math.sin(p * Math.PI) * 0.16);
      ok = this.carveEllipsoid(dimension, cx, cz, x, y, z, rXZ, rXZ * (1.08 - p * 0.2)) && ok;
    }
    return ok;
  }

  private carveRavine(dimension: Dimension, rv: CaveRavine, cx: number, cz: number): boolean {
    let ok = true;
    const lateral = this.hash2(rv.x, rv.z, rv.seed) * Math.PI;
    for (let i = 0; i < rv.length; i++) {
      const p = i / Math.max(1, rv.length - 1);
      const wave = Math.sin(p * Math.PI * 1.2 + lateral);
      const x = rv.x + Math.cos(rv.yaw) * i * 1.75 + Math.cos(rv.yaw + Math.PI / 2) * wave * 1.3;
      const z = rv.z + Math.sin(rv.yaw) * i * 1.75 + Math.sin(rv.yaw + Math.PI / 2) * wave * 1.3;
      const y = rv.topY - 1.2 - p * (5.5 + rv.width * 1.6);
      ok = this.carveEllipsoid(dimension, cx, cz, x, y, z, rv.width * (1.16 - p * 0.26), rv.width * (1.38 - p * 0.48)) && ok;
    }
    return ok;
  }

  private carveSphere(dimension: Dimension, s: CaveSphere, cx: number, cz: number): boolean {
    let ok = true;
    const o = this.cellOrigin(cx, cz);
    const minX = Math.max(o.x, Math.floor(s.x - s.r)), maxX = Math.min(o.x + this.cellX - 1, Math.ceil(s.x + s.r));
    const minZ = Math.max(o.z, Math.floor(s.z - s.r)), maxZ = Math.min(o.z + this.cellZ - 1, Math.ceil(s.z + s.r));
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const nx = (x + 0.5 - s.x) / s.r, nz = (z + 0.5 - s.z) / s.r;
        const h2 = nx * nx + nz * nz;
        if (h2 > 1) continue;
        const half = s.r * Math.sqrt(1 - h2);
        const yLo = Math.max(this.carveFloorY, this.highestBedrockY(x, z) + 1, Math.ceil(s.y - half - 0.5));
        const yHi = Math.min(this.maxSurfaceY + 1, this.topYAt(x, z) + 1, Math.floor(s.y + half - 0.5));
        ok = this.carveSpan(dimension, x, z, yLo, yHi) && ok;
      }
    }
    return ok;
  }

  // =========================================================================
  // Terrain (rows along Z)
  // =========================================================================

  private stoneFillBlock(x: number, y: number, z: number, topY: number): string {
    for (const rule of this.oreRules) {
      if (y < rule.minY || y > topY - rule.maxBelowTop) continue;
      let pass = true;
      for (const n of rule.noises) {
        if (this.valueNoise3D(x * n.scale + n.offset[0], y * n.scale + n.offset[1], z * n.scale + n.offset[2], n.seed) <= n.threshold) {
          pass = false;
          break;
        }
      }
      if (pass) return this.id(rule.block);
    }
    return this.id(this.d.shape.blocks.stone);
  }

  /** Row is empty if there is no bedrock at 3 points (independent of the top, which neighboring trees may intrude on). */
  private rowSeemsEmpty(dimension: Dimension, x: number, originZ: number): boolean {
    for (const dz of [0, this.cellZ >> 1, this.cellZ - 1]) {
      const bed = this.blockTypeId(dimension, { x, y: this.floorY, z: originZ + dz });
      if (bed && bed !== this.airId) return false;
    }
    return true;
  }

  private buildRowTerrain(dimension: Dimension, x: number, originZ: number): boolean {
    const s = this.d.shape;
    const stoneId = this.id(s.blocks.stone), bedrockId = this.id(s.blocks.bedrock), fillerId = this.id(s.blocks.filler);
    const dirt = s.dirtThickness;
    let ok = true;

    const tops: number[] = [];
    const topIds: string[] = [];
    let minTop = Infinity;
    for (let i = 0; i < this.cellZ; i++) {
      const z = originZ + i;
      const t = this.topYAt(x, z);
      tops.push(t);
      topIds.push(this.surfaceBlockFor(this.biomeAt(x, z), x, z, t));
      if (t < minTop) minTop = t;
    }

    const defaultTop = this.id(this.d.biomes[0].surface.primary);
    const z0 = originZ, z1 = originZ + this.cellZ - 1;
    const stoneTop = minTop - dirt - 1;

    ok = this.fillRowZ(dimension, x, z0, z1, this.floorY, this.floorY, bedrockId) && ok;
    ok = this.fillRowZ(dimension, x, z0, z1, this.floorY + 1, stoneTop, stoneId) && ok;

    let st = 0;
    while (st < this.cellZ) {
      let e = st;
      while (e + 1 < this.cellZ && tops[e + 1] === tops[st]) e++;
      const t = tops[st], a = originZ + st, b = originZ + e;
      ok = this.fillRowZ(dimension, x, a, b, stoneTop + 1, t - dirt - 1, stoneId) && ok;
      ok = this.fillRowZ(dimension, x, a, b, t - dirt, t - 1, fillerId) && ok;
      ok = this.fillRowZ(dimension, x, a, b, t, t, defaultTop) && ok;
      st = e + 1;
    }

    const rockIds = new Set<string>(this.d.biomes.map((bm) => this.id(bm.surface.rockBlock)));
    const scanMax = this.d.ores.scanMaxY;
    for (let i = 0; i < this.cellZ; i++) {
      const z = originZ + i, topY = tops[i], id = topIds[i];

      if (rockIds.has(id)) ok = this.fillColumnRun(dimension, x, z, topY - dirt, topY, id) && ok;
      else if (id !== defaultTop) ok = this.setBlockType(dimension, { x, y: topY, z }, id) && ok;

      const hb = this.highestBedrockY(x, z);
      const chances = s.bedrockChances;
      for (let y = this.floorY + 1; y <= hb; y++) {
        const layer = y - this.floorY;
        if (this.hash3(x, y, z, 901 + layer) < (chances[layer - 1] ?? 0.5)) {
          ok = this.setBlockType(dimension, { x, y, z }, bedrockId) && ok;
        }
      }

      const scanTop = Math.min(topY - dirt - 1, scanMax);
      for (let y = hb + 1; y <= scanTop; y++) {
        const blockId = this.stoneFillBlock(x, y, z, topY);
        if (blockId !== stoneId) ok = this.setBlockType(dimension, { x, y, z }, blockId) && ok;
      }
    }
    return ok;
  }

  // =========================================================================
  // Decoration
  // =========================================================================

  private decorateColumn(dimension: Dimension, biome: BiomeJson, x: number, topY: number, z: number): boolean {
    const surface = this.blockTypeId(dimension, { x, y: topY, z });
    if (!surface || !this.surfaceIds.has(surface)) return true;
    const above = { x, y: topY + 1, z };
    if (this.blockTypeId(dimension, above) !== this.airId) return true;

    const r = this.hash2(x, z, 181);
    for (const p of this.plantsByBiome.get(biome.id) ?? []) {
      if (r > p.above) return this.setBlockType(dimension, above, p.id);
    }
    return true;
  }

  private decorateCeilingColumn(dimension: Dimension, biome: BiomeJson, x: number, topY: number, z: number): boolean {
    const cm = biome.decoration.ceilingMoss;
    if (topY - 6 <= this.carveFloorY + 3) return true;
    if (this.hash2(x, z, 611) < cm.columnSkipChance) return true;

    const mossId = this.id(cm.block);
    const minY = this.carveFloorY + 4;
    for (let y = Math.min(topY - 1, cm.maxY); y >= minY; y--) {
      const ceiling = this.blockTypeId(dimension, { x, y, z });
      if (!ceiling || !this.attachIds.has(ceiling)) continue;
      if (this.blockTypeId(dimension, { x, y: y - 1, z }) !== this.airId) continue;
      if (this.blockTypeId(dimension, { x, y: y - 2, z }) !== this.airId) continue;
      if (this.hash2(x + y * 3, z - y * 5, 619) < cm.attachSkipChance) continue;
      return this.placeHangingMoss(dimension, x, y - 1, z, 631 + y, mossId, cm.maxLength);
    }
    return true;
  }

  private decorateRow(dimension: Dimension, x: number, originZ: number): boolean {
    const biome = this.biomeAt(x, originZ + (this.cellZ >> 1));
    let ok = true;
    for (let i = 0; i < this.cellZ; i++) {
      const z = originZ + i, topY = this.topYAt(x, z);
      const surf = this.hash2(x, z, 107) > 1 - biome.decoration.surfaceChance ? this.decorateColumn(dimension, biome, x, topY, z) : true;
      const cave = this.decorateCeilingColumn(dimension, biome, x, topY, z);
      ok = ok && surf && cave;
    }
    return ok;
  }

  private placeHangingMoss(dimension: Dimension, x: number, startY: number, z: number, seed: number, mossId: string, maxLen: number): boolean {
    const length = 1 + Math.floor(this.hash2(x, z, seed) * maxLen);
    let ok = true;
    for (let i = 0; i < length; i++) {
      const loc = { x, y: startY - i, z };
      const existing = this.blockTypeId(dimension, loc);
      if (existing && existing !== this.airId && existing !== mossId) break;
      const done = this.setBlockType(dimension, loc, mossId);
      ok = ok && done;
      if (!done) break;
    }
    return ok;
  }

  // =========================================================================
  // Trees (JSON: structures/*.json)
  // =========================================================================

  private trunkCells(x: number, z: number, sx: number, sz: number, level: number, shiftStart: number): Vec2[] {
    const use = level >= shiftStart;
    const bx = x + (use ? sx : 0), bz = z + (use ? sz : 0);
    return [{ x: bx, z: bz }, { x: bx + 1, z: bz }, { x: bx, z: bz + 1 }, { x: bx + 1, z: bz + 1 }];
  }

  private placeTree(dimension: Dimension, x: number, groundY: number, z: number, seed: number, T: TreeJson): boolean {
    const logId = this.id(T.blocks.log), leavesId = this.id(T.blocks.leaves), mossId = this.id(T.blocks.hangingMoss);
    const logPerm = this.perm(logId, T.states.log);
    const leavesPerm = this.perm(leavesId, T.states.leaves);
    const clearIds = new Set(T.blocks.clearOnTrunkBase.map((n) => this.id(n)));
    let ok = true;

    const placeLog = (px: number, py: number, pz: number): boolean =>
      logPerm ? this.setBlockPerm(dimension, { x: px, y: py, z: pz }, logPerm) : this.setBlockType(dimension, { x: px, y: py, z: pz }, logId);
    const canReplace = (id: string | undefined): boolean => !id || id === this.airId || id === leavesId || id === mossId;

    const trunkHeight = T.trunk.baseHeight + Math.floor(this.hash2(x, z, seed) * T.trunk.heightVariance);
    const shifts = T.trunk.shifts;
    const shift = shifts[Math.floor(this.hash2(x + 9, z - 4, seed + 91) * shifts.length)] ?? [0, 0];
    const [shiftX, shiftZ] = shift;
    const shiftStartY = trunkHeight - (T.trunk.shiftStartFromTop.min + Math.floor(this.hash2(x, z, seed + 37) * T.trunk.shiftStartFromTop.variance));

    // base
    for (const c of this.trunkCells(x, z, 0, 0, 0, trunkHeight + 99)) {
      ok = placeLog(c.x, groundY, c.z) && ok;
      const above = this.blockTypeId(dimension, { x: c.x, y: groundY + 1, z: c.z });
      if (above && clearIds.has(above)) ok = this.setBlockType(dimension, { x: c.x, y: groundY + 1, z: c.z }, this.airId) && ok;
    }

    // trunk
    for (let i = 1; i <= trunkHeight; i++) {
      for (const c of this.trunkCells(x, z, shiftX, shiftZ, i, shiftStartY)) {
        if (canReplace(this.blockTypeId(dimension, { x: c.x, y: groundY + i, z: c.z }))) ok = placeLog(c.x, groundY + i, c.z) && ok;
      }
      if (i === shiftStartY && (shiftX !== 0 || shiftZ !== 0)) {
        for (const c of this.trunkCells(x, z, 0, 0, i, trunkHeight + 99)) {
          if (canReplace(this.blockTypeId(dimension, { x: c.x, y: groundY + i, z: c.z }))) ok = placeLog(c.x, groundY + i, c.z) && ok;
        }
      }
    }

    // spire on top
    if (this.hash2(x - 3, z + 7, seed + 111) > 1 - T.spire.chance) {
      const topCells = this.trunkCells(x, z, shiftX, shiftZ, trunkHeight, shiftStartY);
      const corner = topCells[Math.floor(this.hash2(x + 5, z + 11, seed + 144) * 4) % topCells.length];
      const spireH = T.spire.minHeight + Math.floor(this.hash2(x - 2, z - 8, seed + 173) * T.spire.heightVariance);
      for (let i = 0; i < spireH; i++) {
        const yy = groundY + trunkHeight - 1 + i;
        if (canReplace(this.blockTypeId(dimension, { x: corner.x, y: yy, z: corner.z }))) ok = placeLog(corner.x, yy, corner.z) && ok;
      }
    }

    // creaking heart
    if (this.hash2(x, z, seed + 801) >= 1 - T.creakingHeart.chance) {
      const level = Math.max(groundY + T.creakingHeart.minLevelAboveGround, groundY + trunkHeight - T.creakingHeart.offsetFromTop);
      const cells = this.trunkCells(x, z, shiftX, shiftZ, level - groundY, shiftStartY);
      const cell = cells[Math.floor(this.hash2(x + level, z - level, seed + 807) * cells.length)] ?? cells[0];
      ok = this.setBlockType(dimension, { x: cell.x, y: level, z: cell.z }, this.id(T.blocks.heart)) && ok;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const loc = { x: cell.x + ox, y: level, z: cell.z + oz };
        if (canReplace(this.blockTypeId(dimension, loc))) ok = placeLog(loc.x, loc.y, loc.z) && ok;
      }
    }

    // canopy
    const cbx = x + shiftX + 1, cbz = z + shiftZ + 1, cby = groundY + trunkHeight;
    T.canopy.layers.forEach((layer, idx) => {
      ok = this.placeCanopyLayer(dimension, T, leavesId, leavesPerm, mossId, cbx, cby, cbz, layer.radius, layer.yOffset, seed + idx + 1, layer.corners) && ok;
    });

    // hanging moss
    const hm = T.hangingMoss;
    for (let dx = -hm.radius; dx <= hm.radius; dx++) {
      for (let dz = -hm.radius; dz <= hm.radius; dz++) {
        const edge = Math.max(Math.abs(dx), Math.abs(dz));
        if (edge < hm.minEdge || edge > hm.radius) continue;
        const skip = edge <= hm.innerMaxEdge ? hm.innerSkip : hm.outerSkip;
        if (this.hash2(cbx + dx, cbz + dz, seed + 240) <= skip) continue;
        const hx = cbx + dx, hz = cbz + dz;
        let lowest: number | undefined;
        for (let y = cby - hm.scanBelow; y <= cby + hm.scanAbove; y++) {
          if (this.blockTypeId(dimension, { x: hx, y, z: hz }) === leavesId) { lowest = y; break; }
        }
        if (lowest !== undefined) ok = this.placeHangingMoss(dimension, hx, lowest - 1, hz, seed + 260, mossId, hm.maxLength) && ok;
      }
    }
    return ok;
  }

  private placeCanopyLayer(
    dimension: Dimension, T: TreeJson, leavesId: string, leavesPerm: BlockPermutation | undefined, mossId: string,
    cx: number, cy: number, cz: number, radius: number, yOffset: number, seed: number, corners: boolean,
  ): boolean {
    let fail = false;
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        const dx = Math.abs(x - cx), dz = Math.abs(z - cz);
        const edge = Math.max(dx, dz);
        if (edge > radius) continue;
        if (!corners && dx === radius && dz === radius && this.hash2(x, z, seed) < T.canopy.cornerSkipChance) continue;
        if (edge === radius && this.hash2(x + yOffset, z - yOffset, seed + 13) < T.canopy.edgeSkipChance) continue;

        const loc = { x, y: cy + yOffset, z };
        const existing = this.blockTypeId(dimension, loc);
        if (existing && existing !== this.airId && existing !== mossId && existing !== leavesId) continue;
        const done = leavesPerm ? this.setBlockPerm(dimension, loc, leavesPerm) : this.setBlockType(dimension, loc, leavesId);
        fail ||= !done;
      }
    }
    return !fail;
  }

  private isMountainGround(groundY: number): boolean {
    return this.d.mountains.enabled && groundY > this.d.shape.plainsMaxY;
  }

  private canPlaceTreeBase(dimension: Dimension, T: TreeJson, x: number, groundY: number, z: number): boolean {
    const m = this.isMountainGround(groundY) ? T.placement.mountain : undefined;
    if (this.isMountainGround(groundY) && !m) return false;
    if (m && groundY > m.maxY) return false;
    const maxSlope = m ? m.maxSlope : T.placement.maxSlope;
    const hs = [this.topYAt(x, z), this.topYAt(x + 1, z), this.topYAt(x, z + 1), this.topYAt(x + 1, z + 1)];
    if (Math.max(...hs) - Math.min(...hs) > maxSlope) return false;
    const ground = new Set((m ? m.groundBlocks : T.placement.groundBlocks).map((n) => this.id(n)));
    return [[0, 0], [1, 0], [0, 1], [1, 1]].every(([ox, oz]) => {
      const gy = m ? Math.min(...hs) : groundY;
      const id = this.blockTypeId(dimension, { x: x + ox, y: m ? this.topYAt(x + ox, z + oz) : gy, z: z + oz });
      return !!id && ground.has(id);
    });
  }

  private tryPlaceTree(dimension: Dimension, spot: TreeSpot): boolean {
    const T = this.d.trees[spot.structure];
    if (!T) return true;
    const reach = this.featureMargin;
    this.ensureTerrainBox(dimension, spot.x - reach, spot.z - reach, spot.x + reach, spot.z + reach);
    const surfaceY = this.topYAt(spot.x, spot.z);
    if (!this.canPlaceTreeBase(dimension, T, spot.x, surfaceY, spot.z)) return true;
    return this.placeTree(dimension, spot.x, surfaceY, spot.z, spot.seed, T);
  }

  // =========================================================================
  // Lava pool (JSON: structures/lava_pool.json)
  // =========================================================================

  private lavaJitter(x: number, z: number, seed: number): number {
    return (this.valueNoise(x * 0.38, z * 0.38, seed + 17) - 0.5) * 1.15 + (this.hash2(x, z, seed + 9) - 0.5) * 0.52;
  }

  private hasPoolSupport(dimension: Dimension, P: LavaPoolJson, x: number, z: number, surfaceY: number, poolY: number): boolean {
    const surface = this.blockTypeId(dimension, { x, y: surfaceY, z });
    if (!surface || !P.surfaceBlocks.some((n) => this.id(n) === surface)) return false;
    const bottom = Math.max(this.highestBedrockY(x, z) + 1, poolY - 4);
    for (let y = surfaceY - 1; y >= bottom; y--) {
      const id = this.blockTypeId(dimension, { x, y, z });
      if (!id || id === this.airId) return false;
    }
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const id = this.blockTypeId(dimension, { x: x + ox, y: poolY - 1, z: z + oz });
        if (!id || id === this.airId) return false;
      }
    }
    return true;
  }

  private tryPlaceLavaPool(dimension: Dimension, spot: LavaSpot): boolean {
    const P = this.d.lavaPools[spot.structure];
    if (!P) return true;
    const { x: centerX, z: centerZ, seed } = spot;
    const radius = P.radius.min + Math.floor(this.hash2(centerX, centerZ, seed + 1) * P.radius.variance);
    const stoneRadius = radius + P.stonePad, outerRadius = radius + P.outerPad;
    const reach = Math.ceil(outerRadius);
    const liquid = this.id(P.blocks.liquid), rim = this.id(P.blocks.rim), air = this.id(P.blocks.air);

    let minY = Infinity, maxY = -Infinity;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const y = this.topYAt(centerX + dx, centerZ + dz);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxY - minY > P.maxSlope) return true;
    const poolY = minY - 1;
    if (poolY - 1 <= this.carveFloorY) return true;

    // thin slices: the pool spills into neighbors — ensure their ground first
    this.ensureTerrainBox(dimension, centerX - reach - 1, centerZ - reach - 1, centerX + reach + 1, centerZ + reach + 1);

    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const x = centerX + dx, z = centerZ + dz;
        if (Math.sqrt(dx * dx + dz * dz) + this.lavaJitter(x, z, seed) > stoneRadius) continue;
        if (!this.hasPoolSupport(dimension, P, x, z, this.topYAt(x, z), poolY)) return true;
      }
    }

    let ok = true;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const x = centerX + dx, z = centerZ + dz;
        const d = Math.sqrt(dx * dx + dz * dz) + this.lavaJitter(x, z, seed);
        const localTop = this.topYAt(x, z);
        if (d <= radius - 0.12) {
          ok = this.fillColumnRun(dimension, x, z, poolY + 1, localTop + 2, air) && ok;
          if (poolY - 1 > this.highestBedrockY(x, z)) ok = this.setBlockType(dimension, { x, y: poolY - 1, z }, rim) && ok;
          ok = this.setBlockType(dimension, { x, y: poolY, z }, liquid) && ok;
        } else if (d <= stoneRadius) {
          const from = Math.max(poolY, this.highestBedrockY(x, z) + 1);
          ok = this.fillColumnRun(dimension, x, z, from, localTop, rim) && ok;
          ok = this.fillColumnRun(dimension, x, z, localTop + 1, localTop + 2, air) && ok;
        } else if (d <= outerRadius) {
          for (const yy of [localTop, localTop + 1]) {
            const id = this.blockTypeId(dimension, { x, y: yy, z });
            if (id && this.overlayIds.has(id)) ok = this.setBlockType(dimension, { x, y: yy, z }, air) && ok;
          }
        }
      }
    }
    return ok;
  }

  // =========================================================================
  // Plans (precomputation) and per-slice pipeline
  // =========================================================================

  private isNearShrine(x: number, z: number, extra: number): boolean {
    return this.shrines.some((s) => Math.hypot(s.x - x, s.z - z) <= s.r + extra);
  }

  /** Trees and lava pools are laid out on a fixed feature grid (featureRegion x featureRegion blocks), independent of the cell size. */
  private regionFeatures(rx: number, rz: number): RegionFeatures {
    const ck = this.key(rx, rz);
    const cached = this.regionCache.get(ck);
    if (cached) return cached;

    const R = this.featureRegion;
    const ox = rx * R, oz = rz * R;
    const biome = this.biomeAt(ox + (R >> 1), oz + (R >> 1));
    const lava: LavaSpot[] = [];
    const trees: TreeSpot[] = [];

    biome.features.forEach((f, i) => {
      if (f.type !== "lava_pool") return;
      if (this.hash2(rx, rz, 821 + i * 7) <= 1 - f.chance) return;
      const x = ox + 1 + Math.floor(this.hash2(rx, rz, 829 + i * 7) * Math.max(1, R - 2));
      const z = oz + 4 + Math.floor(this.hash2(rx, rz, 839 + i * 7) * Math.max(1, R - 8));
      if (this.isNearShrine(x, z, f.minDistanceFromShrine)) return;
      lava.push({ x, z, seed: Math.floor(this.hash2(rx, rz, 853 + i * 7) * 100000), structure: f.structure });
    });

    const exclusion = this.shrineDef().treeExclusionRadius;
    for (const rule of biome.trees) {
      const placed: TreeSpot[] = [];
      for (let lx = rule.slotStart; lx < R - 1; lx += rule.slotStep) {
        for (let lz = rule.slotStart; lz < R - 1; lz += rule.slotStep) {
          const x = ox + lx + Math.floor(this.hash2(ox + lx, oz + lz, 221) * 2);
          const z = oz + lz + Math.floor(this.hash2(ox + lx, oz + lz, 331) * 2);
          const chance = this.hash2(x, z, 431);
          const mountain = this.isMountainGround(this.topYAt(x, z));
          const spawn = mountain ? (rule.mountainSpawnChance ?? 0) : rule.spawnChance;
          const spacing = mountain ? (rule.mountainMinSpacingSq ?? rule.minSpacingSq) : rule.minSpacingSq;
          if (spawn <= 0 || chance <= 1 - spawn) continue;
          if (this.isNearShrine(x, z, exclusion)) continue;
          if (placed.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < spacing)) continue;
          placed.push({ x, z, seed: Math.floor(chance * 100000), structure: rule.structure });
        }
      }
      trees.push(...placed);
    }

    if (this.regionCache.size >= 768) {
      const oldest = this.regionCache.keys().next().value;
      if (oldest !== undefined) this.regionCache.delete(oldest);
    }
    const out = { lava, trees };
    this.regionCache.set(ck, out);
    return out;
  }

  private createPlan(cx: number, cz: number): CellPlan {
    const o = this.cellOrigin(cx, cz);
    const caves = this.collectCaves(cx, cz);
    const lavaSpots: LavaSpot[] = [];
    const treeSpots: TreeSpot[] = [];
    const R = this.featureRegion;
    const inCell = (x: number, z: number): boolean =>
      x >= o.x && x <= o.x + this.cellX - 1 && z >= o.z && z <= o.z + this.cellZ - 1;

    for (let rx = Math.floor(o.x / R); rx <= Math.floor((o.x + this.cellX - 1) / R); rx++) {
      for (let rz = Math.floor(o.z / R); rz <= Math.floor((o.z + this.cellZ - 1) / R); rz++) {
        const f = this.regionFeatures(rx, rz);
        for (const l of f.lava) if (inCell(l.x, l.z)) lavaSpots.push(l);
        for (const t of f.trees) if (inCell(t.x, t.z)) treeSpots.push(t);
      }
    }
    return { cx, cz, ...caves, lavaSpots, treeSpots };
  }

  /** One slice as a generator: yields execution every row/batch. Returns true if all ok. */
  private *cellGen(dimension: Dimension, plan: CellPlan, deferTrees = false): CellSteps {
    let ok = true;
    const o = this.cellOrigin(plan.cx, plan.cz);

    for (let lx = 0; lx < this.cellX; lx++) {
      const x = o.x + lx;
      if (this.rowSeemsEmpty(dimension, x, o.z)) ok = this.buildRowTerrain(dimension, x, o.z) && ok;
      yield;
    }

    let n = 0;
    for (const s of plan.caveSpheres) { ok = this.carveSphere(dimension, s, plan.cx, plan.cz) && ok; if (++n % 6 === 0) yield; }
    for (const op of plan.caveOpenings) { ok = this.carveOpening(dimension, op, plan.cx, plan.cz) && ok; if (++n % 6 === 0) yield; }
    for (const rv of plan.caveRavines) { ok = this.carveRavine(dimension, rv, plan.cx, plan.cz) && ok; if (++n % 6 === 0) yield; }
    yield;

    for (const lava of plan.lavaSpots) { ok = this.tryPlaceLavaPool(dimension, lava) && ok; yield; }

    for (let lx = 0; lx < this.cellX; lx++) {
      ok = this.decorateRow(dimension, o.x + lx, o.z) && ok;
      yield;
    }

    if (!deferTrees) {
      for (const tree of plan.treeSpots) { ok = this.tryPlaceTree(dimension, tree) && ok; yield; }
    }
    return ok;
  }

  // =========================================================================
  // Queue (time budget per tick)
  // =========================================================================

  private removeQueued(cx: number, cz: number): void {
    const key = this.key(cx, cz);
    this.queued.delete(key);
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].key === key) this.active.splice(i, 1);
  }

  private processQueue(): void {
    if (this.active.length === 0) return;
    let dimension: Dimension;
    try { dimension = world.getDimension(this.dimensionId); } catch { return; }

    const budget = this.boost ? this.d.throughput.loadingBudgetMs : this.d.throughput.tickBudgetMs;
    const start = Date.now();

    while (this.active.length > 0 && Date.now() - start < budget) {
      const task = this.active[0];
      let done = false, ok = true;
      try {
        if (!task.gen) task.gen = this.cellGen(dimension, this.createPlan(task.cx, task.cz), false);
        const r = task.gen.next();
        if (r.done) { done = true; ok = r.value; }
      } catch { done = true; ok = false; }

      if (done) {
        this.active.shift();
        this.queued.delete(task.key);
        if (ok) this.recent.add(task.key);
      }
    }
  }

  private pruneRecent(): void {
    const max = this.d.throughput.recentCellsMax;
    if (this.recent.size <= max) return;
    let remove = this.recent.size - Math.floor(max * 0.75);
    for (const k of this.recent) {
      if (remove-- <= 0) break;
      this.recent.delete(k);
    }
  }

  private coverageScore(dimension: Dimension, cx: number, cz: number): { score: number; samples: number } {
    const o = this.cellOrigin(cx, cz);
    const xs = this.cellX <= 2
      ? Array.from({ length: this.cellX }, (_, i) => i)
      : [1, this.cellX >> 1, this.cellX - 2];
    const zs = [2, this.cellZ >> 2, this.cellZ >> 1, (this.cellZ * 3) >> 2, this.cellZ - 3];
    let score = 0;
    for (const lx of xs) for (const lz of zs) if (this.columnLooksEstablished(dimension, o.x + lx, o.z + lz)) score++;
    return { score, samples: xs.length * zs.length };
  }

}
