// Loads the dimension JSON files (one file per subject, in ./data) and hands them to main.ts,
// which passes the information on to the classes. The classes (../classes) do NOT import JSON.
// To add a biome/structure: create the .json in ./data, import it here and add it to the list.

import palette from "./data/blocks/palette.json";
import ores from "./data/blocks/ores.json";

import shape from "./data/terrain/shape.json";
import mountains from "./data/terrain/mountains.json";
import caves from "./data/terrain/caves.json";

import paleForestBiome from "./data/biomes/pale_forest.json";

import paleOakTree from "./data/structures/pale_oak_tree.json";
import lavaPool from "./data/structures/lava_pool.json";
import starterShrine from "./data/structures/starter_shrine.json";

import grid from "./data/world/grid.json";
import throughput from "./data/world/throughput.json";
import dimension from "./data/world/dimension.json";
import time from "./data/world/time.json";
import music from "./data/world/music.json";
import loading from "./data/world/loading.json";
import render from "./data/world/render.json";
import seed from "./data/world/seed.json";
import mobs from "./data/world/mobs.json";
import entryTriggers from "./data/world/entry_triggers.json";

import type {
  BiomeJson, DimensionJson, EntryTriggersJson, GridJson, LavaPoolJson, MobsJson, MountainsJson,
  OresJson, PaletteJson, MusicJson, LoadingJson, RenderJson, SeedJson, ShapeJson, ShrineJson, TerrainData, ThroughputJson,
  TimeJson, TreeJson, CavesJson,
} from "../../class/dimensionBuild/types";

const cast = <T>(value: unknown): T => value as T;

const trees: TreeJson[]       = [cast<TreeJson>(paleOakTree)];
const lavaPools: LavaPoolJson[] = [cast<LavaPoolJson>(lavaPool)];
const shrines: ShrineJson[]   = [cast<ShrineJson>(starterShrine)];
const biomes: BiomeJson[]     = [cast<BiomeJson>(paleForestBiome)];

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
};

export const terrainData: TerrainData = {
  palette: cast<PaletteJson>(palette),
  ores: cast<OresJson>(ores),
  shape: cast<ShapeJson>(shape),
  mountains: cast<MountainsJson>(mountains),
  caves: cast<CavesJson>(caves),
  biomes,
  trees: byId(trees),
  lavaPools: byId(lavaPools),
  shrines: byId(shrines),
  grid: cast<GridJson>(grid),
  throughput: cast<ThroughputJson>(throughput),
};

export const dimensionCfg: DimensionJson = cast(dimension);
export const timeCfg: TimeJson = cast(time);
export const musicCfg: MusicJson = cast(music);
export const loadingCfg: LoadingJson = cast(loading);
export const renderCfg: RenderJson = cast(render);
export const seedCfg: SeedJson = cast(seed);
export const mobsCfg: MobsJson = cast(mobs);
export const entryCfg: EntryTriggersJson = cast(entryTriggers);
