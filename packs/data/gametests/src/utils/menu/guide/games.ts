
import { system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';

const Test = async (player) => {
  let form = new ActionFormData()
  form.title("Games")
    .button("Play", "textures/custom_ui/none")
    .button("Back", "textures/custom_ui/none")
    .button(`Select \nyou \n game`, "textures/custom_ui/none")
    .button("Profile ", "textures /custom_ui/none")
    .button("Level", "textures/custom_ui/none")
    .button("Level ", "textures/custom_ui/none")
    .button("Options", "textures/custom_ui/more")
    .button("?", "textures/custom_ui/none")
    .button("Skin", "textures/custom_ui/MashupIcon")
    .button("Shopl", "textures/custom_ui/MCoin")
    .button("Notification", "textures/custom_ui/icon_bell")
    .button("Friends ", "textures/custom_ui/FriendsIcon")
    .button("Label", "textures/custom_ui/icon_recipe_equipment")
    .button("Chat", "textures/custom_ui/icon_sign")
    .button("Add_Right", "textures/custom_ui/plus")
    .button("Add_left", "textures/custom_ui/plus")

  const r = await form.show(player);
  if (r.canceled) return;
  player.playSound("note.bell", { pitch: 1, volume: 0.5 })
  let response = r.selection
  switch (response) {
    case 0:
      player.playSound("note.bell")
      break;
    default:
      player.playSound("note.bell")
      break;
  }
}
world.afterEvents.itemUse.subscribe(async (event) => {
  const { source, itemStack } = event
  switch (itemStack.typeId) {
    case "bs:games":
      Test(source);
      break;
  }
}
)
