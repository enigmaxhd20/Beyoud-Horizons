import { world, system } from "@minecraft/server";
import { handlePlayerJoin, handlePlayerLeave, handleUILoad, handleUILoadLegacy, handleUILoadOld, handleUISubLoad, handleUISubLoadLegacy, handleWorldLoad } from "./UI";

console.log("[UI Queue] Loaded main module!");

system.afterEvents.scriptEventReceive.subscribe( handleUILoadLegacy, { namespaces: [ "ui_load" ]});
system.afterEvents.scriptEventReceive.subscribe( handleUISubLoad, { namespaces: [ "ui_sub_load_script" ]});
system.afterEvents.scriptEventReceive.subscribe( handleUILoad, { namespaces: [ "ui_load_script" ]});
system.afterEvents.scriptEventReceive.subscribe( handleUISubLoadLegacy, { namespaces: [ "ui_sub_load" ]});
system.afterEvents.scriptEventReceive.subscribe( handleUILoadOld, { namespaces: [ "ui" ]});

world.afterEvents.playerSpawn.subscribe(handlePlayerJoin);
world.afterEvents.worldLoad.subscribe(handleWorldLoad);
world.beforeEvents.playerLeave.subscribe(handlePlayerLeave);