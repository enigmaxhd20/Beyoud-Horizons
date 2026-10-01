import { world, system } from "@minecraft/server";
console.log('hello')

/*
const DEBUG = true;

const CHECK_INTERVAL_TICKS = 5;
const LADDER_DETECT_RADIUS = 1; // blocos ao redor da entidade a checar
const EXIT_GRACE_TICKS = 10; // ticks longe da ladder antes de desativar (evita flicker)
const DIMENSIONS = ["overworld", "nether", "the_end"];

 @type {Map<string, {climbing:boolean, lastNearTick:number}>}
const state = new Map();

function log(...args) {
  if (DEBUG) console.warn("[5fs:ladder_climber]", ...args);
}

function isLadderBlock(block) {
  return block !== undefined && block.typeId === "minecraft:ladder";
}

Checa um raio pequeno ao redor da entidade (pés e cabeça) por blocos minecraft:ladder. 
function isNearLadder(entity, dimension) {
  const loc = entity.location;
  const baseX = Math.floor(loc.x);
  const baseY = Math.floor(loc.y);
  const baseZ = Math.floor(loc.z);

  for (let dx = -LADDER_DETECT_RADIUS; dx <= LADDER_DETECT_RADIUS; dx++) {
    for (let dz = -LADDER_DETECT_RADIUS; dz <= LADDER_DETECT_RADIUS; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        const block = dimension.getBlock({ x: baseX + dx, y: baseY + dy, z: baseZ + dz });
        if (isLadderBlock(block)) return true;
      }
    }
  }
  return false;
}

class LadderClimberComponent {
  constructor(entityTypes) {
    this.entityTypes = entityTypes;
  }

  update(tick) {
    for (const dimensionId of DIMENSIONS) {
      const dimension = world.getDimension(dimensionId);
      for (const type of this.entityTypes) {
        const entities = dimension.getEntities({ type });
        for (const entity of entities) {
          this.evaluate(entity, dimension, tick);
        }
      }
    }
  }

  evaluate(entity, dimension, tick) {
    if (!entity.isValid) return;

    const id = entity.id;
    let s = state.get(id);
    if (!s) {
      s = { climbing: false, lastNearTick: -Infinity };
      state.set(id, s);
    }

    const near = isNearLadder(entity, dimension);
    if (near) s.lastNearTick = tick;

    const shouldClimb = tick - s.lastNearTick <= EXIT_GRACE_TICKS;

    if (shouldClimb && !s.climbing) {
      entity.triggerEvent("5fs:enable_ladder_climb");
      s.climbing = true;
      log(entity.typeId, id, "ativou nav_climb (ladder detectada)");
    } else if (!shouldClimb && s.climbing) {
      entity.triggerEvent("5fs:disable_ladder_climb");
      s.climbing = false;
      log(entity.typeId, id, "voltou pra nav_walk");
    }
  }
}

export function initLadderClimberModule(entityTypes = ["minecraft:zombie"]) {
  const component = new LadderClimberComponent(entityTypes);
  let tick = 0;
  system.runInterval(() => {
    tick += CHECK_INTERVAL_TICKS;
    component.update(tick);
  }, CHECK_INTERVAL_TICKS);
  log("módulo inicializado (modo native climb) para:", entityTypes.join(", "));
}
*/