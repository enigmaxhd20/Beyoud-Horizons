import { 
    world, 
    system, 
    ScriptEventCommandMessageAfterEvent, 
    PlayerJoinAfterEvent, 
    PlayerLeaveAfterEvent 
} from "@minecraft/server";

import { 
    UI,
    handleUILoad, 
    handleUISubLoad, 
    handleUILoadLegacy, 
    handleUISubLoadLegacy, 
    handleUILoadOld, 
    handlePlayerJoin, 
    handlePlayerLeave, 
    handleWorldLoad 
} from "../UI";

world.afterEvents.playerJoin.subscribe((event: PlayerJoinAfterEvent) => {
    handlePlayerJoin(event);
});

world.afterEvents.playerLeave.subscribe((event: PlayerLeaveAfterEvent) => {
    handlePlayerLeave(event);
});

system.run(() => {
    handleWorldLoad();
});


system.afterEvents.scriptEventReceive.subscribe(
    (event: ScriptEventCommandMessageAfterEvent) => {
       
        handleUILoad(event);
        handleUISubLoad(event);

        handleUILoadLegacy(event);
        handleUISubLoadLegacy(event);

        handleUILoadOld(event);
    },
    { 
        namespaces: [
            "ui", 
            "ui_load", 
            "ui_sub_load", 
            "ui_load_script", 
            "ui_sub_load_script"
        ] 
    }
);