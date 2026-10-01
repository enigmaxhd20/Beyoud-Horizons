import { world, system, EntityTypes } from "@minecraft/server"
system.run(() => {
  if ((EntityTypes as any).get("uq:ui_queue_checker") != undefined) {
    console.info("[UI Queue Module] This world has UI Queue module installed.")
  } else {
    console.info("[UI Queue Module] Cannot find UI Queue initiate UI Queue.")
    function generateUUID() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0
        const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16);
      });
    } let id = generateUUID(); world.getDimension("minecraft:overworld").runCommand("scriptevent ui_queue_module:setup " + id); let module_count = 0
    system.afterEvents.scriptEventReceive.subscribe((s) => { if (s.id == "ui_queue_module:setup") module_count++; }, { namespaces: ["ui_queue_module"] })
    system.runTimeout(() => {
      if (module_count <= 1) {
        console.info("[UI Queue Module] Attaching UI Queue module to this world."); var ui_queue = {}; var subtitle_queue = {}
        var subtitle_register_queue = {}; var subtitle_bin_queue = {}; let start_queue = false
        var ui_now = {}; var ui_update_time = {}
        var ui_update_loop = {}
        var registered_id = []
        var registered_name = {}
        var player_dimension = {}
        system.afterEvents.scriptEventReceive.subscribe((s) => {
          let id = s.sourceEntity.id; if (!ui_queue[id]) {
            ui_queue[id] = {}
            ui_now[id] = {}; ui_update_time[id] = {}; ui_update_loop[id] = {};
          } if (ui_now[id][s.id.split(":")[1]] == s.message) { return; }
          else { ui_now[id][s.id.split(":")[1]] = s.message; } ui_queue[id][s.id.split(":")[1]] = s.message; ui_update_time[id][s.id.split(":")[1]] = system.currentTick + 20
          ui_update_loop[id][s.id.split(":")[1]] = 0
          if (registered_name[s.id.split(":")[1]] == undefined) { registered_id.push(s.id.split(":")[1]); registered_name[s.id.split(":")[1]] = {}; }
        }, { namespaces: ["ui_load"] }); system.afterEvents.scriptEventReceive.subscribe((s) => {
          let data = s.message.split("|"); let id = data[0]
          if (subtitle_queue[id] == undefined) {
            subtitle_queue[id] = {}; subtitle_register_queue[id] = []
            subtitle_bin_queue[id] = {}
          } if (!subtitle_register_queue[id].includes(s.id.split(":")[1])) { subtitle_register_queue[id].push(s.id.split(":")[1]); } subtitle_queue[id][s.id.split(":")[1]] = { text: data[1], id: s.id.split(":")[1], };
        }, { namespaces: ["ui_sub_load_script"] }); system.afterEvents.scriptEventReceive.subscribe((s) => {
          let data = s.message.split("|"); let id = data[0]; if (!ui_queue[id]) {
            ui_queue[id] = {}
            ui_now[id] = {}; ui_update_time[id] = {}; ui_update_loop[id] = {};
          } if (ui_now[id][s.id.split(":")[1]] == data[1]) { return; } else { ui_now[id][s.id.split(":")[1]] = data[1]; } ui_queue[id][s.id.split(":")[1]] = data[1]
          ui_update_time[id][s.id.split(":")[1]] = system.currentTick + 20; ui_update_loop[id][s.id.split(":")[1]] = 0; if (registered_name[s.id.split(":")[1]] == undefined) {
            registered_id.push(s.id.split(":")[1]); registered_name[s.id.split(":")[1]] = {}
          }
        }, { namespaces: ["ui_load_script"] }); system.afterEvents.scriptEventReceive.subscribe((s) => {
          let id = s.sourceEntity.id; if (subtitle_queue[id] == undefined) {
            subtitle_queue[id] = {}
            subtitle_register_queue[id] = []; subtitle_bin_queue[id] = {};
          } if (!subtitle_register_queue[id].includes(s.id.split(":")[1])) { subtitle_register_queue[id].push(s.id.split(":")[1]); } subtitle_queue[id][s.id.split(":")[1]] = { text: s.message, id: s.id.split(":")[1], };
        }, { namespaces: ["ui_sub_load"] }); system.afterEvents.scriptEventReceive.subscribe((s) => {
          if (s.id != "ui:set") return; let id = s.sourceEntity.id
          if (!ui_queue[id]) { ui_queue[id] = {}; ui_now[id] = {}; ui_update_time[id] = {}; ui_update_loop[id] = {}; } if (ui_now[id][s.message.split(" ")[1]] == s.message) { return; } else { ui_now[id][s.message.split(" ")[1]] = s.message; } ui_queue[id][s.message.split(" ")[1]] = s.message.replace(" ", ""); ui_update_time[id][s.message.split(" ")[1]] = system.currentTick + 20; ui_update_loop[id][s.message.split(" ")[1]] = 0; if (registered_name[s.message.split(" ")[1]] == undefined) { registered_id.push(s.message.split(" ")[1]); registered_name[s.message.split(" ")[1]] = {}; }
        }, { namespaces: ["ui"] }); system.runInterval(() => {
          for (let playerData of world.getPlayers()) {
            if (!start_queue) { start_queue = true; return; } if (player_dimension[playerData.id] != playerData.dimension.id) {
              for (let id of registered_id) {
                if (ui_update_time[playerData.id][id] == undefined) continue
                ui_update_time[playerData.id][id] = system.currentTick; ui_update_loop[playerData.id][id] = 0;
              } player_dimension[playerData.id] = playerData.dimension.id;
            } if (!ui_queue[playerData.id]) continue; let keys = Object.keys(ui_queue[playerData.id])
            if (keys.length == 0) {
              for (let id of registered_id) {
                if (ui_update_time[playerData.id][id] == undefined || ui_now[playerData.id][id] == undefined) continue
                if (system.currentTick - ui_update_time[playerData.id][id] > 10) { ui_queue[playerData.id][id] = ui_now[playerData.id][id].replace(" " + id, id); ui_update_time[playerData.id][id] = system.currentTick + 20 * ui_update_loop[playerData.id][id]; ui_update_loop[playerData.id][id] += 1; if (Math.random() > 0.6) break; }
              } continue;
            } let set_ui = keys[0]; if (ui_queue[playerData.id][set_ui] != undefined) {
              let text = ui_queue[playerData.id][set_ui]; let data: any = { fadeInDuration: 0, fadeOutDuration: 0, stayDuration: 0, }; try { text = JSON.parse(text); } catch (err) { } if (subtitle_queue[playerData.id]) {
                let subtitle = subtitle_queue[playerData.id][set_ui]
                if (subtitle) {
                  let sub = subtitle.text; try { sub = JSON.parse(sub); } catch (err) { } data.subtitle = sub.toString()
                  delete subtitle_queue[playerData.id][set_ui];
                }
              } playerData.onScreenDisplay.setTitle(String(text), data as any); delete ui_queue[playerData.id][set_ui];
            }
          }
        });
      } else {
        console.error("§c[UI Queue Module] Found multiple UI Queue Module, please install UI Queue to this world to enable custom UI.")
        world.afterEvents.playerJoin.subscribe((s) => { (world.getEntity(s.playerId) as any)?.sendMessage("Please install UI Queue in this world to use custom UI!"); });
      }
    }, 2);
  }
})