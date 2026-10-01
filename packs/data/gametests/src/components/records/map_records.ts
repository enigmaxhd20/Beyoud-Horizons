import { ItemTypes, ItemStack, system } from '@minecraft/server';

const musicDiscs = new Map();

function autoDiscoverRecords() {
    const allTypes = ItemTypes.getAll();

    for (const type of allTypes) {
        try {
            const tempStack = new ItemStack(type);

            if (tempStack.hasTag("bs:records")) {
                const id = type.id;

                // Format name: "bsgraze_the_roof" -> "Graze The Roof"
                const cleanName = id
                    .split(':')[1]
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');

                musicDiscs.set(id, cleanName);
                // console.warn(`[Jukebox] Registered: ${id}`);
            }
        } catch (e) {
            // Some items fail to instantiate; ignore them.
            continue;
        }
    }
}

// FIX: Wait until the world is actually running before accessing ItemTypes
system.run(() => {
    autoDiscoverRecords();
});

export { musicDiscs };