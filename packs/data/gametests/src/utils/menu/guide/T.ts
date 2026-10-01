import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world
} from "@minecraft/server";
import { EntityData, WorldData, ItemData } from "../../save_data/data_json/storage.js"
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { DefaultSettings } from "../../../events/set_dynamic/settings/default_settings"
//import { WailaSettingsManager } from "../../../components/waila/main.js"

const Mycustom = async (player) => {
  let form = new ActionFormData();
  form.title(`bs.title.profile.main`)
    .body("")
    .button("bs.button.info.profile", "textures/icons/heart_new")
    .button("bs.button.my_friends.profile", "textures/icons/friends")
    .button("bs.button.quest.profile", "textures/icons/more")
    .button("bs.button.how_to_play.profile", "textures/icons/comment")
    .button("bs.button.settings.profile", "textures/icons/settings")
    .button("bs.button.chargelogs.profile", "textures/icons/invite_base")
    .button("bs.button.faq.profile", "textures/icons/magnifyingGlass");

  const r = await form.show(player);
  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0.5 })
  let response = r.selection;
  switch (response) {
    case 0:
      Comming(player)
      break;
    case 1:
      Comming(player)
      break;
    case 2:
      Comming(player)
      break;
    case 3:
      Comming(player)
      break;
    case 4:
      SettingsMain(player)
      break;
    case 5:
      Comming(player)
      break;
    default:
      FAQ(player)
      break;
  }
}
const Charglogs = async (player) => {
  let form = new ActionFormData();
  form.title(`§l§7Charglogs`)
    .body(`here is the database about the updates `)
    .button("0.0.3")
    .button(`§l§3Back`)

  const r = await form.show(player);
  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0.5 });
  let response = r.selection
  switch (response) {
    case 0:
      Update_0_0_3(player);
  }
}
const Update_0_0_3 = async (player) => {
  let form = new MessageFormData()
  form.title(`§5 Update 0.0.3`)
    .body(`Waila added to the add-on.`)
    .button1(`§1FAQ`)
    .button2('§3Back')
  const r = await form.show(player);
  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0.5 });
  let response = r.selection
  switch (response) {
    case 0:
      FAQ(player)
      break;
    case 1:
      Charglogs
  }

}
const FAQ = async (player) => {
  let form = new MessageFormData()
  form.title(`§8FAQ`)
    .body(`hello ${player.tag} This is an add-on that is under development and bugs may occur. `)
    .button1(`§3Back`)
    .button2(`close`)
  const r = await form.show(player)
  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0.5 })
  let response = r.selection
  switch (response) {
    case 0:
      Mycustom(player)
      break
  }
}
const SettingsMain = async (player) => {
  let form = new ActionFormData()
    .title(`bs.title.settings.main`)
    .body(`bs.body.settings.main`)
    .button(`bs.button.waila.settings.main`, "textures/icons/waila")
    .button(`bs.button.quick_settings.settings.main`, "textures/icons/settings")

  let r = await form.show(player)
  if (r.canceled) return
  player.playSound("note.bell")
  let response = r.selection
  switch (response) {
    case 0:
      Waila(player)
      break
    case 1:
      Settings(player)
      break
  }
}
const Settings = async (player) => {
  const speed_score = player.getDynamicProperty("speed_score") ?? false
  const wailaStatus = player.getDynamicProperty("bs:waila_show") ?? true;
  const speedStatus = player.getDynamicProperty("speed_show") ?? false;
  const wellcome = player.getDynamicProperty("wellcome_show") ?? true;
  const biome_find = player.getDynamicProperty("biome_hud_learning") ?? true
  const updateInSeconds = player.getDynamicProperty("ticks_per_seconds") ?? 1
  const floating = player.getDynamicProperty("speed_decimal_place") ?? 2
  const stop = player.getDynamicProperty("speed_show_s") ?? false;
  let form = new ModalFormData()
    .title(`bs.title.quick_settings`)
    .toggle("bs.toggle.waila_show.quick_settings", { defaultValue: wailaStatus })
    .toggle("bs.toggle.speed_show.quick_settings", { defaultValue: speedStatus })
    .toggle("bs.toggle.wellcome_show.quick_settings", { defaultValue: wellcome })
    .divider()
    .label("bs.label.definitions.quick_settings")
    .toggle("bs.toggle.biome_find.quick_settings", { defaultValue: biome_find })
    .slider("bs.slider.updatefunctions.quick_settings", 0, 50, { defaultValue: updateInSeconds, valueStep: 1, tooltip: "This is a function that allows you to regulate the frequency at which the functions are performed." })
    .divider()
    .label("bs.label.speed_definitions.quick_settings")
    .slider("bs.slider.floating-point.quick_settings", 0, 20, { defaultValue: floating, valueStep: 1 })
    .toggle("bs.toggle.speed_show_stop.quick_settings", { defaultValue: stop })
    .toggle("bs.toggle.stop_score.quick_settings", { defaultValue: speed_score })
  let r = await form.show(player);
  if (r.canceled || !r.formValues) return;
  player.playSound("note.bell");
  const [w, s, wc, _div1, _lbl1, bf, uf, _div2, _lbl2, fp, ss, sts] = r.formValues
  if (w) {
    //WailaSettingsManager.set(player, "isEnabled", true)
  }
  if (!w) {
    //WailaSettingsManager.set(player, "isEnabled", false)
  }
  player.setDynamicProperty("bs:waila_show", w)
  player.setDynamicProperty("speed_show", s)
  player.setDynamicProperty("wellcome_show", wc)
  player.setDynamicProperty("ticks_per_seconds", uf)
  player.setDynamicProperty("speed_decimal_place", fp)
  player.setDynamicProperty("biome_hud_learning", bf)
  player.setDynamicProperty("speed_show_s", ss)
  player.setDynamicProperty("speed_score", sts)
};

const Comming = async (player) => {
  let form = new MessageFormData();
  form.title("bs.title.comming"),
    form.body(`bs.body.comming`)
  form.button1(`§l§2Ok`)
  form.button2(`§l§3Back`);

  const r = await form.show(player);

  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0 })
  let response = r.selection;
  switch (response) {
    case 0:
      Mycustom(player)
      break;
    case 1:
      Mycustom(player)
  }
}
world.afterEvents.itemUse.subscribe(async (event) => {
  const { source, itemStack } = event
  switch (itemStack.typeId) {
    case "bs:profile":
      Mycustom(source); break;
  }
})
system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    {
      name: "bs:profile",
      description: "A menu with options and settings.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false
    },
    (origin) => { // Removed 'player' from here
      const player = origin.sourceEntity;

      // Check if it's actually a player (using typeId or checking if entity exists)
      if (!player) {
        return {
          status: CustomCommandStatus.Failure,
          message: "This command can only be used by a player.",
        };
      }

      system.run(() => Mycustom(player));
      return { status: CustomCommandStatus.Success };
    }
  );
});
let NewData = [{ id: "waila_show", st: true }, {
  id: "speed_show", st: false
},
{
  id: "wellcome_show", st: true
}]
NewData.forEach((item) => {
  DefaultSettings.set(item.id, item.st)
})
const Waila = (player) => {
  system.run(() => {
    player.runCommand("bs:waila")
  })
}