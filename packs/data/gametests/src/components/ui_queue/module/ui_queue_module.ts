import { 
    world, 
    system, 
    EntityTypes, 
    Player, 
    TitleDisplayOptions, 
    ScriptEventCommandMessageAfterEvent 
} from "@minecraft/server";

system.run(() => {
    if ((EntityTypes as any).get("uq:ui_queue_checker") !== undefined) {
        console.info("[UI Queue Module] This world has UI Queue module installed.");
        return;
    }

    console.info("[UI Queue Module] Cannot find UI Queue initiate UI Queue.");

    function generateUUID(): string {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    const id = generateUUID();
    world.getDimension("minecraft:overworld").runCommand(`scriptevent ui_queue_module:setup ${id}`);
    
    let module_count = 0;
    system.afterEvents.scriptEventReceive.subscribe((s) => {
        if (s.id === "ui_queue_module:setup") module_count++;
    }, { namespaces: ["ui_queue_module"] });

    system.runTimeout(() => {
        if (module_count > 1) {
            console.error("§c[UI Queue Module] Found multiple UI Queue Module, please install UI Queue to this world to enable custom UI.");
            world.afterEvents.playerJoin.subscribe((s) => {
                const player = world.getEntity(s.playerId);
                if (player instanceof Player && player.isValid) {
                    player.sendMessage("Please install UI Queue in this world to use custom UI!");
                }
            });
            return;
        }

        console.info("[UI Queue Module] Attaching UI Queue module to this world.");

        // Dicionários do módulo de UI
        const ui_queue: Record<string, Record<string, string>> = {};
        const subtitle_queue: Record<string, Record<string, { text: string; id: string }>> = {};
        const subtitle_register_queue: Record<string, string[]> = {};
        const subtitle_bin_queue: Record<string, Record<string, unknown>> = {};
        const ui_now: Record<string, Record<string, string>> = {};
        const ui_update_time: Record<string, Record<string, number>> = {};
        const ui_update_loop: Record<string, Record<string, number>> = {};
        const registered_id: string[] = [];
        const registered_name: Record<string, Record<string, unknown>> = {};
        const player_dimension: Record<string, string> = {};
        let start_queue = false;

        // Limpeza de memória quando o jogador sai
        world.afterEvents.playerLeave.subscribe((s) => {
            const playerId = s.playerId;
            delete ui_queue[playerId];
            delete subtitle_queue[playerId];
            delete subtitle_register_queue[playerId];
            delete subtitle_bin_queue[playerId];
            delete ui_now[playerId];
            delete ui_update_time[playerId];
            delete ui_update_loop[playerId];
            delete player_dimension[playerId];
        });

        // 1. Namespace: ui_load
        system.afterEvents.scriptEventReceive.subscribe((s: ScriptEventCommandMessageAfterEvent) => {
            if (!(s.sourceEntity instanceof Player)) return;
            const entityId = s.sourceEntity.id;
            const subId = s.id.split(":")[1];

            if (!ui_queue[entityId]) {
                ui_queue[entityId] = {};
                ui_now[entityId] = {};
                ui_update_time[entityId] = {};
                ui_update_loop[entityId] = {};
            }

            if (ui_now[entityId][subId] === s.message) return;
            
            ui_now[entityId][subId] = s.message;
            ui_queue[entityId][subId] = s.message;
            ui_update_time[entityId][subId] = system.currentTick + 20;
            ui_update_loop[entityId][subId] = 0;

            if (registered_name[subId] === undefined) {
                registered_id.push(subId);
                registered_name[subId] = {};
            }
        }, { namespaces: ["ui_load"] });

        // 2. Namespace: ui_sub_load_script
        system.afterEvents.scriptEventReceive.subscribe((s: ScriptEventCommandMessageAfterEvent) => {
            const data = s.message.split("|");
            const targetId = data[0];
            const subId = s.id.split(":")[1];

            if (subtitle_queue[targetId] === undefined) {
                subtitle_queue[targetId] = {};
                subtitle_register_queue[targetId] = [];
                subtitle_bin_queue[targetId] = {};
            }

            if (!subtitle_register_queue[targetId].includes(subId)) {
                subtitle_register_queue[targetId].push(subId);
            }

            subtitle_queue[targetId][subId] = { text: data[1], id: subId };
        }, { namespaces: ["ui_sub_load_script"] });

        // 3. Namespace: ui_load_script
        system.afterEvents.scriptEventReceive.subscribe((s: ScriptEventCommandMessageAfterEvent) => {
            const data = s.message.split("|");
            const targetId = data[0];
            const subId = s.id.split(":")[1];

            if (!ui_queue[targetId]) {
                ui_queue[targetId] = {};
                ui_now[targetId] = {};
                ui_update_time[targetId] = {};
                ui_update_loop[targetId] = {};
            }

            if (ui_now[targetId][subId] === data[1]) return;

            ui_now[targetId][subId] = data[1];
            ui_queue[targetId][subId] = data[1];
            ui_update_time[targetId][subId] = system.currentTick + 20;
            ui_update_loop[targetId][subId] = 0;

            if (registered_name[subId] === undefined) {
                registered_id.push(subId);
                registered_name[subId] = {};
            }
        }, { namespaces: ["ui_load_script"] });

        // 4. Namespace: ui_sub_load
        system.afterEvents.scriptEventReceive.subscribe((s: ScriptEventCommandMessageAfterEvent) => {
            if (!(s.sourceEntity instanceof Player)) return;
            const entityId = s.sourceEntity.id;
            const subId = s.id.split(":")[1];

            if (subtitle_queue[entityId] === undefined) {
                subtitle_queue[entityId] = {};
                subtitle_register_queue[entityId] = [];
                subtitle_bin_queue[entityId] = {};
            }

            if (!subtitle_register_queue[entityId].includes(subId)) {
                subtitle_register_queue[entityId].push(subId);
            }

            subtitle_queue[entityId][subId] = { text: s.message, id: subId };
        }, { namespaces: ["ui_sub_load"] });

        // 5. Namespace: ui
        system.afterEvents.scriptEventReceive.subscribe((s: ScriptEventCommandMessageAfterEvent) => {
            if (s.id !== "ui:set" || !(s.sourceEntity instanceof Player)) return;
            const entityId = s.sourceEntity.id;
            const parts = s.message.split(" ");
            const targetKey = parts[1];

            if (!ui_queue[entityId]) {
                ui_queue[entityId] = {};
                ui_now[entityId] = {};
                ui_update_time[entityId] = {};
                ui_update_loop[entityId] = {};
            }

            if (ui_now[entityId][targetKey] === s.message) return;

            ui_now[entityId][targetKey] = s.message;
            ui_queue[entityId][targetKey] = s.message.replace(" ", "");
            ui_update_time[entityId][targetKey] = system.currentTick + 20;
            ui_update_loop[entityId][targetKey] = 0;

            if (registered_name[targetKey] === undefined) {
                registered_id.push(targetKey);
                registered_name[targetKey] = {};
            }
        }, { namespaces: ["ui"] });

        // Loop principal de renderização de UI
        system.runInterval(() => {
            if (!start_queue) {
                start_queue = true;
                return;
            }

            for (const playerData of world.getPlayers()) {
                // Valida se o jogador está pronto e renderizado no mundo (isValid é booleana)
                if (!playerData || !playerData.isValid) continue;

                const pId = playerData.id;

                // Verificação de troca de dimensão
                if (player_dimension[pId] !== playerData.dimension.id) {
                    for (const idKey of registered_id) {
                        if (ui_update_time[pId]?.[idKey] === undefined) continue;
                        ui_update_time[pId][idKey] = system.currentTick;
                        ui_update_loop[pId][idKey] = 0;
                    }
                    player_dimension[pId] = playerData.dimension.id;
                }

                if (!ui_queue[pId]) continue;

                const keys = Object.keys(ui_queue[pId]);

                if (keys.length === 0) {
                    for (const idKey of registered_id) {
                        if (ui_update_time[pId]?.[idKey] === undefined || ui_now[pId]?.[idKey] === undefined) continue;

                        if (system.currentTick - ui_update_time[pId][idKey] > 10) {
                            ui_queue[pId][idKey] = ui_now[pId][idKey].replace(" " + idKey, idKey);
                            ui_update_time[pId][idKey] = system.currentTick + 20 * ui_update_loop[pId][idKey];
                            ui_update_loop[pId][idKey] += 1;
                            if (Math.random() > 0.6) break;
                        }
                    }
                    continue;
                }

                const set_ui = keys[0];
                if (ui_queue[pId][set_ui] !== undefined) {
                    let text: unknown = ui_queue[pId][set_ui];
                    const data: TitleDisplayOptions = {
                        fadeInDuration: 0,
                        fadeOutDuration: 0,
                        stayDuration: 0,
                    };

                    try {
                        text = JSON.parse(text as string);
                    } catch {}

                    if (subtitle_queue[pId]) {
                        const subtitle = subtitle_queue[pId][set_ui];
                        if (subtitle) {
                            let sub: unknown = subtitle.text;
                            try {
                                sub = JSON.parse(sub as string);
                            } catch {}
                            data.subtitle = String(sub);
                            delete subtitle_queue[pId][set_ui];
                        }
                    }

                    playerData.onScreenDisplay.setTitle(String(text), data);
                    delete ui_queue[pId][set_ui];
                }
            }
        });
    }, 2);
});