import { system, BlockPermutation } from "@minecraft/server";

system.beforeEvents.startup.subscribe((initEvent) => {
    initEvent.blockComponentRegistry.registerCustomComponent("bs:crops", {
        beforeOnPlayerPlace(e, params) {
            const p = params as any;
            if (!p.on_farmland_only) return;
            const belowPos = { x: e.block.location.x, y: e.block.location.y - 1, z: e.block.location.z };
            const below = e.dimension.getBlock(belowPos);
            if (below?.typeId !== "minecraft:farmland") {
                e.cancel = true;
            }
        },

        onRandomTick(e, params) {
            const { block, dimension } = e;
            const p = params as any;

            if (p.dies_if_dry) {
                const below = block.below();
                if (below?.typeId !== "minecraft:farmland") {
                    dimension.setBlockPermutation(block.location, BlockPermutation.resolve("minecraft:air"));
                    return;
                }
            }

            if (p.grows_over_time) {
                const age = Number(block.permutation.getState("bs:age" as any) ?? 0);
                if (age < 3) {
                    block.setPermutation(block.permutation.withState("bs:age" as any, age + 1));
                }
            }
        },

        onPlayerInteract(e, params) {
            const p = params as any;
            if (!p.harvest_loot_table) return;
            const { player, block, dimension } = e;
            const pos = block.location;
            dimension.runCommand(`loot spawn ${pos.x} ${pos.y} ${pos.z} loot ${p.harvest_loot_table}`);
            if (p.damage_on_harvest && player) {
                player.applyDamage(p.damage_on_harvest, { cause: "thorns" as any });
            }
        }
    });
});