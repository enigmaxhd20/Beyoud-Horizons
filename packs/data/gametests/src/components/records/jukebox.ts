import { system, world, MolangVariableMap } from '@minecraft/server';
import { musicDiscs } from './map_records.js';

// --- State Maps ---
let playingJukeboxes = new Map();     // Key: "x,y,z" -> "soundId"
let latestRecordLocations = new Map(); // Key: "soundId" -> { locationKey, dimensionId }
let physicalDiscState = new Map();     // Key: "x,y,z" -> "itemTypeId" (Remembers disc on unload)

const DYNAMIC_PROPERTY_ID = "jukebox_states";

// --- Persistence ---
// We now save TWO states: active sounds AND physical disc memory.
function loadJukeboxStates() {
  const jsonString = world.getDynamicProperty(DYNAMIC_PROPERTY_ID);
  if (typeof jsonString === 'string') {
    try {
      const data = JSON.parse(jsonString);

      // Rest berfore Active Sounds
      if (data.playing) {
        for (const [key, val] of data.playing) {
          playingJukeboxes.set(key, val);
        }
      }

      // Restore Physical Memory (Fixes the De-render Bug)
      if (data.physical) {
        for (const [key, val] of data.physical) {
          physicalDiscState.set(key, val);
        }
      }
    } catch (e) { }
  }
}

function saveJukeboxStates() {
  const data = {
    playing: Array.from(playingJukeboxes.entries()),
    physical: Array.from(physicalDiscState.entries())
  };
  world.setDynamicProperty(DYNAMIC_PROPERTY_ID, JSON.stringify(data));
}

system.run(loadJukeboxStates);

// --- Core Logic ---

function stopSound(locationKey, dimensionId) {
  if (!playingJukeboxes.has(locationKey)) return;

  const soundId = playingJukeboxes.get(locationKey);
  const [x, y, z] = locationKey.split(',').map(Number);

  try {
    const dim = world.getDimension(dimensionId);
    // Targeted stop
    dim.runCommand(`stopsound @a[x=${x},y=${y},z=${z},r=60] ${soundId}`);
  } catch (e) { }

  playingJukeboxes.delete(locationKey);

  // Clean up "Latest" tracker
  if (latestRecordLocations.get(soundId)?.locationKey === locationKey) {
    latestRecordLocations.delete(soundId);
  }

  saveJukeboxStates();
}

/**
 * Start Sound Logic
   */
function startSound(block, itemStack) {
  const { x, y, z } = block.location;
  const dimensionId = block.dimension.id;
  const locationKey = `${x},${y},${z}`;
  const soundId = `records.${itemStack.typeId.replace('bs', '')}`;
  const songName = musicDiscs.get(itemStack.typeId);

  // 1. UPDATE PHYSICAL STATE
  // Mark this disc as "Known" immediately so the scanner doesn't trigger again
  physicalDiscState.set(locationKey, itemStack.typeId);

  // 2. CHECK IF ALREADY PLAYING
  if (playingJukeboxes.get(locationKey) === soundId) {
    saveJukeboxStates(); // Ensure physical state is saved
    return;
  }

  // 3. ANTI-GLITCH: Last One Wins (Takeover)
  if (latestRecordLocations.has(soundId)) {
    const previous = latestRecordLocations.get(soundId);
    if (previous.locationKey !== locationKey) {
      stopSound(previous.locationKey, previous.dimensionId);
    }
  }

  // 4. STOP LOCAL
  if (playingJukeboxes.has(locationKey)) {
    stopSound(locationKey, dimensionId);
  }

  // 5. REGISTER NEW STATE
  latestRecordLocations.set(soundId, { locationKey, dimensionId });
  playingJukeboxes.set(locationKey, soundId);

  // Save both the playing state and physical state
  saveJukeboxStates();

  // 6. PLAY AUDIO
  try {
    block.dimension.runCommand(`stopsound @a[x=${x},y=${y},z=${z},r=64] ${soundId}`);

    // CHANGED: Replaced .playSound() with command to enforce r=64 radius
    block.dimension.runCommand(`playsound ${soundId} @a[x=${x},y=${y},z=${z},r=64] ${x} ${y} ${z}`);
  } catch (e) { }

  // 7. SHOW TITLE
  const nearby = block.dimension.getPlayers({ location: block.location, maxDistance: 16 });
  for (const p of nearby) {
    p.onScreenDisplay.setActionBar(`§dNow playing: ${songName}`);
  }

  // 8. PARTICLES
  const particleRunner = system.runInterval(() => {
    try {
      if (playingJukeboxes.get(locationKey) !== soundId) {
        system.clearRun(particleRunner);
        return;
      }

      const dim = world.getDimension(dimensionId);
      try {
        // If chunk is unloaded, spawnParticle usually fails silently or throws
        const b = dim.getBlock({ x, y, z });
        if (b) {
          const vars = new MolangVariableMap();
          vars.setFloat('variable.r', Math.random());
          vars.setFloat('variable.g', Math.random());
          vars.setFloat('variable.b', Math.random());
          dim.spawnParticle("pa:custom_note_particle", { x: x + 0.5, y: y + 1.2, z: z + 0.5 }, vars);
        }
      } catch (e) { }
    } catch (e) {
      system.clearRun(particleRunner);
    }
  }, 20);
}

// --- Monitoring & Automation ---

/**
 * Universal Heartbeat (De-render Safe)
   * Checks for block destruction but IGNORES unloaded chunks.
      */
system.runInterval(() => {
  for (const [locationKey, soundId] of playingJukeboxes) {
    const [x, y, z] = locationKey.split(',').map(Number);

    let dimensionId = "minecraft:overworld";
    const latest = latestRecordLocations.get(soundId);
    if (latest && latest.locationKey === locationKey) dimensionId = latest.dimensionId;

    try {
      const dim = world.getDimension(dimensionId);
      const block = dim.getBlock({ x, y, z });

      // --- DE-RENDER PROTECTION ---
      // If block is undefined, the chunk is UNLOADED (De-rendered).
      // We do NOT stop the sound. We keep the state active in memory.
      if (block === undefined) {
        continue;
      }

      // 1. Destruction Check (Loaded, but not a jukebox?)
      if (block.typeId !== "minecraft:jukebox") {
        stopSound(locationKey, dimensionId);
        physicalDiscState.delete(locationKey);
        continue;
      }

      // 2. Empty Check (Hopper removed disc?)
      const recordPlayer = block.getComponent("minecraft:record_player");
      const record = recordPlayer?.getRecord();

      if (!record) {
        stopSound(locationKey, dimensionId);
        physicalDiscState.set(locationKey, "empty");
        saveJukeboxStates();
        continue;
      }

      // 3. Swap Check
      const expectedSound = `records.${record.typeId.replace('bs', '')}`;
      if (expectedSound !== soundId) {
        stopSound(locationKey, dimensionId);
      }

    } catch (e) {
      // Assume unloaded if error occurs
    }
  }
}, 20);

/**
 * Discovery Scanner (Automation & Re-render)
   * Detects CHANGES in the physical disc state.
      */
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const dim = player.dimension;
    const pos = player.location;

    for (let x = -4; x <= 4; x++) {
      for (let y = -2; y <= 2; y++) {
        for (let z = -4; z <= 4; z++) {
          // Try/Catch for edge of simulation
          try {
            const block = dim.getBlock({ x: Math.floor(pos.x + x), y: Math.floor(pos.y + y), z: Math.floor(pos.z + z) });

            if (block?.typeId === "minecraft:jukebox") {
              const locKey = `${block.location.x},${block.location.y},${block.location.z}`;
              const recordPlayer = block.getComponent("minecraft:record_player");
              const record = recordPlayer?.getRecord();

              // Determine Current vs Last Memory
              const currentId = record ? record.typeId : "empty";
              const lastId = physicalDiscState.get(locKey);

              // LOGIC: Only trigger action if the state has CHANGED
              // If de-rendered and re-rendered, lastId comes from `saveJukeboxStates`
              // So currentId === lastId, meaning we do NOTHING (Preventing repeat).
              if (currentId !== lastId) {
                if (record && musicDiscs.has(record.typeId)) {
                  startSound(block, record);
                } else {
                  physicalDiscState.set(locKey, currentId);
                  saveJukeboxStates();
                }
              }
            }
          } catch (e) { }
        }
      }
    }
  }
}, 20); // Frequency

// --- Events ---

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const { block } = event;
  if (block.typeId !== "minecraft:jukebox") return;

  system.run(() => {
    const locKey = `${block.location.x},${block.location.y},${block.location.z}`;
    const recordPlayer = block.getComponent("minecraft:record_player");
    const record = recordPlayer?.getRecord();

    if (record && musicDiscs.has(record.typeId)) {
      startSound(block, record);
    } else {
      // Eject Event
      stopSound(locKey, block.dimension.id);
      physicalDiscState.set(locKey, "empty");
      saveJukeboxStates();
    }
  });
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const { player, block } = event;
  const { x, y, z } = block.location;
  const locationKey = `${x},${y},${z}`;

  if (playingJukeboxes.has(locationKey)) {
    stopSound(locationKey, block.dimension.id);
    return;
  }
});