import { system } from "@minecraft/server";
import { GlobalUIDatabase } from "../T.js";

// Fast Display settings (In ticks: 1 tick = 0.05s)
// Visual animation window: 1 + 4 + 1 = 6 ticks (0.30s)
const TITLE_CONFIG = {
  fadeInDuration: 1,
  stayDuration: 0,
  fadeOutDuration: 0
};
// Ultra-fast transition between queue indices as requested
const COOLDOWN_TICKS = 1;

// Complex Central Tick Processing Engine
system.runInterval(() => {
  GlobalUIDatabase.forEach(uiInstance => {
    const player = uiInstance.source;

    // CRITICAL SAFETY: Validate if player entity is spawned, alive and valid
    if (!player || !player.isValid) return;

    // WORLD LOAD SYSTEM: Retain and prevent sending titles until player screen stabilizes
    if (!uiInstance.isFullyLoaded) {
      if (uiInstance.loadDelayTicks > 0) {
        uiInstance.loadDelayTicks--;
        return; // Blocks execution but preserves items stacking in queue array safely
      }
      uiInstance.isFullyLoaded = true;
    }

    // Clean layout timing tracking on dimension traversal
    if (player.dimension.id !== uiInstance.lastDimension) {
      uiInstance.lastDimension = player.dimension.id;
      uiInstance.ticksRemaining = 0;
    }

    // Handle animation cooldown locking boundaries
    if (uiInstance.ticksRemaining > 0) {
      uiInstance.ticksRemaining--;
      return;
    }

    if (uiInstance.queue.length === 0) return;

    // Shift next validated stable frame data
    let currentUi = uiInstance.queue.shift();

    if (currentUi.title !== undefined) {
      const options: any = {
        fadeInDuration: TITLE_CONFIG.fadeInDuration,
        stayDuration: TITLE_CONFIG.stayDuration,
        fadeOutDuration: TITLE_CONFIG.fadeOutDuration
      };

      if (currentUi.sub !== undefined) {
        options.subtitle = typeof currentUi.sub === 'object'
          ? JSON.stringify(currentUi.sub)
          : currentUi.sub.toString();
      }

      player.onScreenDisplay.setTitle(currentUi.title, options);

      // Establish the complex lock sequence (Animation + 2 Ticks Clearance Buffer)
      uiInstance.ticksRemaining =
        TITLE_CONFIG.fadeInDuration +
        TITLE_CONFIG.stayDuration +
        TITLE_CONFIG.fadeOutDuration +
        COOLDOWN_TICKS;
    }
  });
}, 1);

export class UiQueueManager {
  // Advanced Title queue handling with array-index preservation matching original map concept
  static enqueueTitle(uiInstance, identifier, input, isPriority) {
    try { input = JSON.parse(input); } catch (err) { }
    const formattedTitle = typeof input === "number" ? input.toString() : input;

    let existingItem = uiInstance.queue.find(item => item.id === identifier);

    if (existingItem) {
      // Overwrite content text immediately while maintaining its exact stable order in the queue array
      existingItem.title = formattedTitle;
      if (isPriority) existingItem.isPriority = true;
    } else {
      let uiData = {
        id: identifier,
        title: formattedTitle,
        isPriority: isPriority
      };

      if (isPriority) {
        // Keep FIFO priority indexing inside structural tier boundaries
        let lastPriorityIndex = -1;
        for (let i = 0; i < uiInstance.queue.length; i++) {
          if (uiInstance.queue[i].isPriority) lastPriorityIndex = i;
        }
        uiInstance.queue.splice(lastPriorityIndex + 1, 0, uiData);
      } else {
        uiInstance.queue.push(uiData);
      }
    }
  }

  // Advanced Subtitle queue handling with array-index preservation matching original map concept
  static enqueueSubtitle(uiInstance, identifier, input, isPriority) {
    try { input = JSON.parse(input); } catch (err) { }
    const formattedSubtitle = typeof input === "number" ? input.toString() : input;

    let existingItem = uiInstance.queue.find(item => item.id === identifier);

    if (existingItem) {
      // Overwrite subtitle text immediately while maintaining its exact stable order in the queue array
      existingItem.sub = formattedSubtitle;
      if (isPriority) existingItem.isPriority = true;
    } else {
      let uiData = {
        id: identifier,
        title: "",
        sub: formattedSubtitle,
        isPriority: isPriority
      };

      if (isPriority) {
        let lastPriorityIndex = -1;
        for (let i = 0; i < uiInstance.queue.length; i++) {
          if (uiInstance.queue[i].isPriority) lastPriorityIndex = i;
        }
        uiInstance.queue.splice(lastPriorityIndex + 1, 0, uiData);
      } else {
        uiInstance.queue.push(uiData);
      }
    }
  }
}
