// Data types. The JSON files live in src/dimension/data and are loaded by src/dimension/config.ts,
// which esbuild bundles into the script (Minecraft scripts cannot read files at runtime).
// Classes never import JSON; they receive the data through their constructors.

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }
export interface CellCoords { cx: number; cz: number }
export interface StarterLanding { x: number; y: number; z: number; groundY: number }

// ---- blocks/palette.json ----
export interface PaletteJson { blocks: Record<string, string> }

// ---- blocks/ores.json ----
export interface NoiseRule { scale: number; offset: [number, number, number]; seed: number; threshold: number }
export interface OreRule { id: string; block: string; minY: number; maxBelowTop: number; noises: NoiseRule[] }
export interface OresJson { scanMaxY: number; rules: OreRule[] }

// ---- terrain/shape.json ----
export interface ShapeJson {
  baseY: number; plainsMinY: number; plainsMaxY: number;
  bedrockFloorY: number; bedrockLayers: number; bedrockChances: number[];
  dirtThickness: number;
  octaves: Array<{ scale: number; seed: number; amplitude: number }>;
  blocks: { air: string; bedrock: string; stone: string; filler: string };
}

// ---- terrain/mountains.json ----
export interface MountainsJson {
  enabled: boolean; height: number; coverage: number; blendWidth: number; frequency: number;
  regionOffset: [number, number]; regionSeed: number; ridgeSeed: number;
  ridgeFrequencyMul: number; ridgePower: number; baseBody: number;
  rough: Array<{ scale: number; seed: number; amplitude: number }>;
  clearCenter: Vec2; clearInner: number; clearOuter: number; extraHeadroom: number;
}

// ---- terrain/caves.json ----
export interface CavesJson {
  cellSize: number; margin: number; minStepLength: number; maxStepLength: number;
  branchChance: number; systemChance: number; extraSystemChance: number;
  surfaceSystemChance: number; surfaceOpeningChance: number; ravineChance: number;
  openingLengthMin: number; openingLengthMax: number;
  carvable: string[];
}

// ---- biomes/*.json ----
export interface BiomeJson {
  id: string;
  /** Optional. Biomes without a selection rule are the fallback; a lone biome needs none. */
  selection?: { scale: number; seed: number; min: number; max: number };
  surface: {
    rockBlock: string; rockLineY: number; rockBlendBlocks: number;
    primary: string; secondary: string; primaryChance: number;
  };
  decoration: {
    surfaceChance: number;
    plants: Array<{ block: string; above: number }>;
    ceilingMoss: {
      block: string; columnSkipChance: number; attachSkipChance: number;
      maxY: number; maxLength: number; attachBlocks: string[];
    };
  };
  trees: Array<{
    structure: string; slotStart: number; slotStep: number; spawnChance: number; minSpacingSq: number;
    /** Spawn chance on mountain terrain (surface above the plains). 0/absent = no trees on mountains. */
    mountainSpawnChance?: number;
    mountainMinSpacingSq?: number;
  }>;
  features: Array<{ type: "lava_pool"; structure: string; chance: number; minDistanceFromShrine: number }>;
}

// ---- structures/*.json ----
export interface TreeJson {
  id: string;
  blocks: { log: string; leaves: string; heart: string; hangingMoss: string; clearOnTrunkBase: string[] };
  states: { log: Record<string, string | number | boolean>; leaves: Record<string, string | number | boolean> };
  placement: {
    groundBlocks: string[]; maxSlope: number;
    /** Rules used when the ground is on a mountain (surface above shape.plainsMaxY). */
    mountain?: { groundBlocks: string[]; maxSlope: number; maxY: number };
  };
  trunk: {
    baseHeight: number; heightVariance: number;
    shifts: Array<[number, number]>;
    shiftStartFromTop: { min: number; variance: number };
  };
  spire: { chance: number; minHeight: number; heightVariance: number };
  creakingHeart: { chance: number; minLevelAboveGround: number; offsetFromTop: number };
  canopy: {
    cornerSkipChance: number; edgeSkipChance: number;
    layers: Array<{ radius: number; yOffset: number; corners: boolean }>;
  };
  hangingMoss: {
    radius: number; minEdge: number; innerMaxEdge: number;
    innerSkip: number; outerSkip: number; maxLength: number; scanBelow: number; scanAbove: number;
  };
}

export interface LavaPoolJson {
  id: string;
  blocks: { liquid: string; rim: string; air: string };
  radius: { min: number; variance: number };
  stonePad: number; outerPad: number; maxSlope: number;
  surfaceBlocks: string[];
}

export interface ShrineJson {
  id: string; radius: number; clearHeight: number; teleportBufferY: number;
  reuseDistance: number; treeExclusionRadius: number;
  blocks: { floor: string; fence: string; door: string; air: string };
  door: { dx: number; dz: number };
}

// ---- world/*.json ----
export interface GridJson { cellX: number; cellZ: number; featureRegion: number }

export interface ThroughputJson {
  tickBudgetMs: number; loadingBudgetMs: number; recentCellsMax: number;
  /** Hard time box (ms) of the synchronous part of one streaming call. */
  immediateBudgetMs: number;
  playerImmediateMaxCells: number; coverageThreshold: number; scanIntervalTicks: number;
  /** Cells of the render circle evaluated per scan call. */
  scanBatch: number;
  /** Blocks the player must move before the render circle is rescanned. */
  rescanDistance: number;
  /** Upper bound of the generation queue. */
  maxQueued: number;
}

export interface DimensionJson {
  id: string; shrine: string; fogId: string; fogLayerId: string;
  returnPropertyKey: string; gameModePropertyKey: string; shrinesPropertyKey: string;
}

/** src/dimension/data/world/music.json — passed to Ambience by the dimension script. */
export interface MusicJson {
  enabled: boolean; trackId: string; loop: boolean; fade: number; volume: number;
  stopDelayTicks: number; primaryDelayTicks: number; fallbackDelayTicks: number;
}

export interface TimeJson { useWorldClock: boolean; clockId: string; timeTicks: number; fallbackToGlobalTime: boolean }

/** src/dimension/data/world/loading.json — the short black-screen hold while the player arrives. */
export interface LoadingJson {
  /** Round radius (blocks) around the arrival point generated before the screen is released. 0 = release as soon as the player is placed. */
  arrivalRadius: number;
  maxHoldTicks: number;
  progressIntervalTicks: number;
  loadingScreen: {
    fade: boolean;
    color: { red: number; green: number; blue: number };
    /** Practically infinite: the black screen stays until the arrival is ready. */
    holdSeconds: number;
    fadeOutSeconds: number;
  };
}

/** src/dimension/data/world/render.json — the generation circle follows the player's render distance. */
export interface RenderJson {
  /** Use the client's render distance (player.clientSystemInfo.maxRenderDistance) when the API exposes it. */
  useClientRenderDistance: boolean;
  /** Render distance (chunks) used when the client value is unavailable. */
  fallbackChunks: number;
  /** Chunks generated beyond the render distance. */
  extraChunks: number;
  minRadius: number;
  maxRadius: number;
}

export interface SeedJson { useWorldSeed: boolean; manualSeed: number | string | null; overrideKey: string; autoKey: string }

export interface MobsJson {
  warden: {
    checkIntervalTicks: number; spawnChance: number; minSpawnDistance: number;
    maxSpawnDistance: number; existingRadius: number; spawnAttempts: number;
  };
  creakingTrialKey: { dropChance: number; entityCooldownTicks: number };
}

export interface EntryTrigger {
  enabled: boolean; direction: "enter" | "exit"; kind: "block" | "item";
  blocks?: string[]; item?: string; consumeItem?: boolean; sneak?: boolean; sound?: boolean;
}
export interface EntryTriggersJson { enabled: boolean; commandsEnabled: boolean; triggers: EntryTrigger[] }

// ---- aggregated data handed to the class ----
export interface TerrainData {
  palette: PaletteJson;
  ores: OresJson;
  shape: ShapeJson;
  mountains: MountainsJson;
  caves: CavesJson;
  biomes: BiomeJson[];
  trees: Record<string, TreeJson>;
  lavaPools: Record<string, LavaPoolJson>;
  shrines: Record<string, ShrineJson>;
  grid: GridJson;
  throughput: ThroughputJson;
}
