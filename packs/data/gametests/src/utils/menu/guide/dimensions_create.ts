import {
  world,
  system,
  Player,
  Entity,
  BlockPermutation,
  BlockVolume,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { BlockList } from "../../../dimensions/custom_dim/blocks.js"
import { EntityData, WorldData, ItemData } from "../../save_data/data_json/storage.js"
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

let Bl = BlockList
const Color = {
  red: "\xA7c",
  aqua: "\xA7b",
  green: "\xA7a",
  darkRed: "\xA74",
  purple: "\xA75",
  yellow: "\xA7e",
  gray: "\xA77",
  darkGray: "\xA78",
  bold: "\xA7l",
  reset: "\xA7r",
};
const DimensionsUi = async (player) => {
  let form: any = new ActionFormData();
  let DimensionsList = WorldData.getIdsByPrefix(`dim:`); //
  form.title(`§l§r dimension of ${player.nameTag}`);
  for (const dimensionId of DimensionsList) {
    const result = WorldData.get(dimensionId);
    if (Array.isArray(result) && result.length > 0) {
      const Na = result[0];
      if (Na && Na.name) {
        form.button(`§8§l${Na.name}`);
      } else {
        player.sendMessage(`§c Error searching ${Na}`)
      }
    } else {

    }
  }
  form.button(`edit`)
  form.button(`§l§2+Add`)
  const r = await form.show(player);
  if (r.canceled || r.selection === undefined) return;
  const IsEditButtom = r.selection === DimensionsList.length
  const IsAddButton = r.selection === DimensionsList.length + 1;
  if (IsAddButton) {
    return CreatDimension(player);
  } if (IsEditButtom) {
    ComingSoon(player)
  }
  else {
    const idSelected = DimensionsList[r.selection];
    const data = WorldData.get(idSelected); //

    if (Array.isArray(data) && data.length > 0) {
      const info = data[0];
      player.sendMessage(`§a§l> §rSelected: §e${info.name}`);
      ComingSoon(player)
    } else {
      player.sendMessage("§c Error: Could not load this dimension.");
    }
  }
};

const ComingSoon = async (player) => {
  let form = new MessageFormData()
  form.title("The feature will arrive soon. ")
    .body("The feature is still under development, so it's not possible to use it yet, but stay tuned for updates. ")
    .button1("View more")
    .button2("Ok");

  const r = await form.show(player)
  if (r.canceled) return
  player.playSound("note.bell")
  switch (r.selection) {
    default: DimensionsUi(player)
      break
  }
}
//creation menu 
const CreatDimension = async (player) => {
  let form: any = new ModalFormData()
  form.title("§l§7Maker dimensions")
    .textField("dimension_id", "Dimension name, e.g., french fries ")
    .toggle("With decoration ", { defaultValue: true, tooltip: "When activated, the decorations will be active." })
    .toggle("Glass rim ", { defaultValue: true, tooltip: "When active, a glass barrier will be generated." })
    .toggle("Creature generation ", { defaultValue: true, tooltip: "monsters can be generated " })
    .dropdown("Ground block ", Bl.map((block) => block.name))
    .slider("Radius", 5, 20, { defaultValue: 6, tooltip: "the radius number of the platform ", valueStep: 1 })
    .textField("center x", "the coordinates of the center of its dimension ", { defaultValue: "0" })
    .textField("center y", "the coordinates of the center of its dimension", { defaultValue: "63" })
    .textField("center z", "the coordinates of the center of its dimension", { defaultValue: "0" })

  const r = await form.show(player);
  if (r.canceled || !r.formValues || !r.formValues[0]) return
  player.playSound("note.bell");
  const [id, decoration, border, creature_generation, ground, radius, x_s, y_s, z_s] = r.formValues as any[]
  let x = Number(x_s)
  let y = Number(y_s)
  let z = Number(z_s)
  const Id_ = typeof id === "string" ? id.trimEnd() : String(id ?? "").trimEnd()
  const DimensionsSetting = [{
    name: Id_,
    decorations: decoration,
    glass_rim: border,
    creatures: creature_generation,
    block: ground,
    radius: radius,
    center: { x, y, z },
  }]
  const Id_lower = Id_.replace(/ /g, "_").toLocaleLowerCase()
  let Id_registry_1 = WorldData.getIdsByPrefix(`dim:`)
  let Id_save = `dim:${Id_lower}`
  let Id_registry = Id_registry_1.map((cd => cd.replace("dim:", "").trim().trimEnd()
  ))
  if ([x, y, z].every(num => !Number.isNaN(num)) && !Id_registry.includes(Id_lower)) {
    WorldData.set(Id_save, DimensionsSetting)
    player.sendMessage(`§l§a> §r§edimension ${Id_} saved successfully, please wait for construction.`)
  } else if (Id_registry.includes(Id_lower)) {
    player.sendMessage(`§cThis ${Id_} has already been registered.`)
  } else if ([x, y, z].every(num => Number.isNaN(num))) {
    player.sendMessage(`§cerror when setting center from ${Id_} `)
  }
};
//comand
system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    {
      name: "bs:dimensions_create",
      description: "Open the dimension create travel menu",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "This command can only be used by a player.",
        };
      }
      system.run(() => DimensionsUi(player));
      return { status: CustomCommandStatus.Success };
    }
  );
});
