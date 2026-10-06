import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world,
  PlayerAimAssist,
  WorldClock,
  BlockRecipeCraftingComponent,
  PlayerPermissionLevel,
} from '@minecraft/server';
import {
  EntityData,
  WorldData,
  ItemData,
} from '../../save_data/data_json/storage.js';
import {
  CustomForm,
  MessageBox,
  ObservableBoolean,
  ObservableNumber,
} from '@minecraft/server-ui';
import { DefaultSettings } from '../../../components/player/default/settings/default_settings.js';
import { playerStatistics } from '../../../components/player/statistics.js';
import {
  DynamicDefinitions,
  DynamicObject,
} from '../../../components/player/friends/addFrieds.js';
import { randomNumber } from '../../../components/generation/random_code/generation.js';
import list from '../data/gameModes.json';
import {
  GameModeBlockedWorld,
  Gmo,
} from '../../../components/settings/gamemode/gamemode.js';
const Mycustom = async (player: Player) => {
  const form = new CustomForm(player, { translate: 'bs.title.profile.main' });
  form
    .button({ translate: 'bs.button.info.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Comming(player);
    })
    .button({ translate: 'bs.button.my_friends.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await My_Friends(player);
    })
    .button({ translate: 'bs.button.quest.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Comming(player);
    })
    .button({ translate: 'bs.button.how_to_play.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Comming(player);
    })
    .button({ translate: 'bs.button.settings.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await SettingsMain(player);
    })
    .button({ translate: 'bs.button.chargelogs.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Charglogs(player);
    })
    .button({ translate: 'bs.button.faq.profile' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await FAQ(player);
    })
    .closeButton();

  await form.show();
};

const My_Friends = async (player: Player) => {
  const form = new CustomForm(player, { translate: 'bs.title.my_friends' });
  const myFriends: DynamicObject[] = DynamicDefinitions.list(player, 'friends');

  form.label({ translate: 'bs.body.my_friends' });

  if (myFriends.length === 0) {
    form.label({ translate: 'bs.label.myfriends_empty.myfriends' });
  } else {
    const allPlayers: Player[] = world.getAllPlayers();

    for (const myFriend of myFriends) {
      if (myFriend.status === 'invite') {
        form.button({ translate: 'bs.button.my_friends.invite' }, async () => {
          form.close();
          await Invites(player);
        });
      } else {
        const friendPlayer = allPlayers.find(
          (p) => p.nameTag === myFriend.nameTag,
        );
        if (myFriend.status !== 'sent') {
          form.button(myFriend.nameTag, async () => {
            form.close();
            player.playSound('note.bell', { pitch: 1, volume: 0.5 });
            if (friendPlayer) {
              await friendOptions(player, friendPlayer, myFriend);
            } else {
              player.sendMessage({ translate: 'bs.message.player_offline' });
            }
          });
        } else {
          break;
        }
      }
    }
  }

  form
    .button({ translate: 'bs.button.add_friend.my_friends' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await AddFriend(player);
    })
    .closeButton();

  await form.show();
};

const Invites = async (player: Player) => {
  const form = new CustomForm(player, {
    translate: 'bs.title.invites.invites',
  });
  const allInvites: DynamicObject[] = DynamicDefinitions.list(
    player,
    'friends',
  );
  const pendingInvites = allInvites.filter((inv) => inv.status === 'invite');

  if (pendingInvites.length === 0) {
    form.label({ translate: 'bs.label.empyty_invites.invites' });
  } else {
    const allPlayers: Player[] = world.getAllPlayers();

    for (const invite of pendingInvites) {
      const friendPlayer = allPlayers.find((p) => p.nameTag === invite.nameTag);

      form.button(invite.nameTag, async () => {
        form.close();
        await ConfirmInvite(player, friendPlayer, invite);
      });
    }
  }

  form.closeButton();
  await form.show();
};

const AddFriend = async (player: Player) => {
  const form = new CustomForm(player, {
    translate: 'bs.title.addfriend.AddFriend',
  });

  const listFriends: DynamicObject[] = DynamicDefinitions.list(
    player,
    'friends',
  );
  const existingFriendIds = new Set(listFriends.map((f) => f.id));

  const eligiblePlayers = world
    .getAllPlayers()
    .filter((p) => p.id !== player.id && !existingFriendIds.has(p.id));

  if (eligiblePlayers.length === 0) {
    form.label({ translate: 'bs.label.enptyPlayers.Addfriend' });
  } else {
    for (const fr of eligiblePlayers) {
      form.button(fr.nameTag, async () => {
        form.close();

        const friendObject: DynamicObject = {
          id: fr.id,
          nameTag: fr.nameTag,
          status: 'sent',
        };
        const playerObject: DynamicObject = {
          id: player.id,
          nameTag: player.nameTag,
          status: 'invite',
        };

        DynamicDefinitions.add(player, 'friends', friendObject);
        DynamicDefinitions.add(fr, 'friends', playerObject);

        player.sendMessage({
          translate: 'bs.message.invite_sent',
          with: [fr.nameTag],
        });
        fr.sendMessage({
          translate: 'bs.message.invite_received',
          with: [player.nameTag],
        });
      });
    }
  }

  form.closeButton();
  await form.show();
};

const friendOptions = async (
  player: Player,
  friend: Player,
  friendObject: DynamicObject,
) => {
  const form = new CustomForm(player, {
    translate: 'bs.title.friend.friendOptions',
    with: [friend.nameTag],
  });
  form
    .button({ translate: 'bs.button.statistics.friendOptions' }, async () => {
      form.close();
      await Friend_statics(player, friend);
    })
    .button({ translate: 'bs.button.remove.friendOptions' }, async () => {
      form.close();
      await friendRemove(player, friend, friendObject);
    })
    .closeButton();
  await form.show();
};

const ConfirmInvite = async (
  player: Player,
  friend: Player | undefined,
  friendObject: DynamicObject,
) => {
  const box = new MessageBox(player, { translate: 'bs.title.invite' });
  box
    .body({
      translate: 'bs.body.invite_request',
      with: [friendObject.nameTag],
    })
    .button1({ translate: 'bs.button.accept' })
    .button2({ translate: 'bs.button.decline' });

  const r = await box.show();
  if (!r.selection) return;

  player.playSound('note.bell', { pitch: 1, volume: 0.5 });

  if (r.selection === 1) {
    DynamicDefinitions.delete(player, 'friends', friendObject);
    DynamicDefinitions.add(player, 'friends', {
      ...friendObject,
      status: 'friend',
    });

    player.sendMessage({
      translate: 'bs.message.now_friends',
      with: [friendObject.nameTag],
    });

    if (friend) {
      // Atualiza o lado de quem ENVIOU (friend)
      const friendSideList: DynamicObject[] = DynamicDefinitions.list(
        friend,
        'friends',
      );
      const playerOnFriendSide = friendSideList.find(
        (f) =>
          (f.id === player.id || f.nameTag === player.nameTag) &&
          f.status === 'sent',
      );

      if (playerOnFriendSide) {
        DynamicDefinitions.delete(friend, 'friends', playerOnFriendSide);
        DynamicDefinitions.add(friend, 'friends', {
          ...playerOnFriendSide,
          status: 'friend',
        });
      }

      friend.sendMessage({
        translate: 'bs.message.friend_accepted',
        with: [player.nameTag],
      });
    }
  } else {
    // Se RECUSOU: apaga de quem recebeu e de quem enviou
    DynamicDefinitions.delete(player, 'friends', friendObject);

    if (friend) {
      const friendSideList: DynamicObject[] = DynamicDefinitions.list(
        friend,
        'friends',
      );
      const playerOnFriendSide = friendSideList.find(
        (f) =>
          (f.id === player.id || f.nameTag === player.nameTag) &&
          f.status === 'sent',
      );
      if (playerOnFriendSide) {
        DynamicDefinitions.delete(friend, 'friends', playerOnFriendSide);
      }

      friend.sendMessage({
        translate: 'bs.message.friend_denied',
        with: [player.nameTag],
      });
    }

    player.sendMessage({ translate: 'bs.message.invite_declined' });
  }

  await Invites(player);
};

const friendRemove = async (
  player: Player,
  friend: Player,
  friendObject: DynamicObject,
) => {
  const box = new MessageBox(player, {
    translate: 'bs.title.remove.friendRemove',
  });

  box.body({
    translate: 'bs.body.remove.friendRemove',
    with: [friendObject.nameTag],
  });
  box.button1({ translate: 'bs.button.accept' });
  box.button2({ translate: 'bs.button.cancel' });

  const r = await box.show();
  if (!r.selection) return;

  if (r.selection === 1) {
    player.playSound('note.bell', { pitch: 1, volume: 0.5 });

    DynamicDefinitions.delete(player, 'friends', friendObject);
    if (friend) {
      const friendList: DynamicObject[] = DynamicDefinitions.list(
        friend,
        'friends',
      );
      const playerOnFriendSide = friendList.find(
        (f) => f.id === player.id || f.nameTag === player.nameTag,
      );
      if (playerOnFriendSide) {
        DynamicDefinitions.delete(friend, 'friends', playerOnFriendSide);
      }

      friend.sendMessage({
        translate: 'bs.message.remove.friendRemove',
        with: [player.nameTag],
      });
    }

    player.sendMessage({
      translate: 'bs.message.friend_removed',
      with: [friendObject.nameTag],
    });
  } else {
    player.playSound('note.bell', { pitch: 1, volume: 0.5 });
  }
};

const Friend_statics = async (player: Player, friend: Player) => {
  const form = new CustomForm(player, { translate: 'bs.title.friend_statics' });
  const playerStats = playerStatistics.getPlayerStatistics(friend);

  form
    .label({ translate: 'bs.body.friend_statics' })
    .spacer()
    .label(`§l§3${friend.nameTag}`)
    .spacer()
    .label(`§l§4Death Count: §f${playerStats.deathCount}`)
    .spacer()
    .label(`§l§6Location: §f${playerStats.locationPlayer}`)
    .spacer()
    .label(`§l§2Life Count: §f${playerStats.lifeCount}`)
    .spacer()
    .button({ translate: 'bs.button.back.friend_statics' }, async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await My_Friends(player);
    })
    .closeButton();

  await form.show();
};

const Charglogs = async (player: Player) => {
  const form = new CustomForm(player, '§l§7Changelogs');
  form
    .label('Add-on update history:')
    .button('0.0.3', async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Update_0_0_3(player);
    })
    .button('§l§3Back', async () => {
      form.close();
      player.playSound('note.bell', { pitch: 1, volume: 0.5 });
      await Mycustom(player);
    })
    .closeButton();

  await form.show();
};

const Update_0_0_3 = async (player: Player) => {
  const box = new MessageBox(player, '§5 Update 0.0.3');
  box.body('Waila added to the add-on.').button1('§1FAQ').button2('§3Back');

  const r = await box.show();
  if (!r.selection) return;

  player.playSound('note.bell', { pitch: 1, volume: 0.5 });
  switch (r.selection) {
    case 1:
      await FAQ(player);
      break;
    case 2:
      await Charglogs(player);
      break;
  }
};

const FAQ = async (player: Player) => {
  const box = new MessageBox(player, '§8FAQ');
  box
    .body(
      `Hello ${player.nameTag}! This add-on is currently under development.`,
    )
    .button1('§3Back')
    .button2('Close');

  const r = await box.show();
  if (!r.selection) return;

  player.playSound('note.bell', { pitch: 1, volume: 0.5 });
  if (r.selection === 1) {
    await Mycustom(player);
  }
};

const SettingsMain = async (player: Player) => {
  const form = new CustomForm(player, { translate: 'bs.title.settings.main' });
  form
    .label({ translate: 'bs.body.settings.main' })
    .button({ translate: 'bs.button.waila.settings.main' }, async () => {
      form.close();
      player.playSound('note.bell');
      await Waila(player);
    })
    .button(
      { translate: 'bs.button.quick_settings.settings.main' },
      async () => {
        form.close();
        player.playSound('note.bell');
        await Settings(player);
      },
    );
  if (player.playerPermissionLevel === PlayerPermissionLevel.Operator) {
    form.button(
      { translate: 'bs.button.PlayerAdmConfing.SettingsMain' },
      async () => {
        form.close();
        player.playSound('note.bell');
        await AdmSettings(player);
      },
    );
  }
  form.closeButton();

  await form.show();
};

const AdmSettings = async (player: Player) => {
  const toItems = (list: string[]) =>
    list.map((n, i) => ({
      label: n,
      value: i,
    }));
  let form = new CustomForm(player, { translate: 'bs.title.AdmSettings' });
  const gamemodeStatus =
    (player.getDynamicProperty('gamemodeB') as boolean) ?? false;
  const gamemodeB = new ObservableBoolean(gamemodeStatus, {
    clientWritable: true,
  });
  const selecGamemodeBlockStatus: number =
    (player.getDynamicProperty('selecGamemodeBlocked') as number) ?? 0;
  const selecGamemodeBlocked = new ObservableNumber(selecGamemodeBlockStatus, {
    clientWritable: true,
  });

  gamemodeB.subscribe((v) => player.setDynamicProperty('gamemodeB', v));
  selecGamemodeBlocked.subscribe((v) =>
    player.setDynamicProperty('selecGamemodeBlocked', v),
  );

  const text = list.modes[selecGamemodeBlocked.getData()];

  form
    .toggle({ translate: 'bs.toggle.gamemodeBlocked.AdmSettings' }, gamemodeB)
    .dropdown(
      { translate: 'bs.dropdown.selectGamemodeblock.AdmSettings' },
      selecGamemodeBlocked,
      toItems(list.modes),
      { visible: gamemodeB },
    );

  if (gamemodeB) {
    let objgmo: Gmo = {
      modeBlocked: text,
    };
    GameModeBlockedWorld.set('GameMode', JSON.stringify(objgmo));
  } else {
    GameModeBlockedWorld.set('GameMode',undefined)
  }
  form.closeButton();
  await form.show();
};

const Settings = async (player: Player) => {
  const speed_score =
    (player.getDynamicProperty('speed_score') as boolean) ?? false;
  const wailaStatus =
    (player.getDynamicProperty('bs:waila_show') as boolean) ?? true;
  const speedStatus =
    (player.getDynamicProperty('speed_show') as boolean) ?? false;
  const wellcome =
    (player.getDynamicProperty('wellcome_show') as boolean) ?? true;
  const biome_find =
    (player.getDynamicProperty('biome_hud_learning') as boolean) ?? true;
  const updateInSeconds =
    (player.getDynamicProperty('ticks_per_seconds') as number) ?? 1;
  const floating =
    (player.getDynamicProperty('speed_decimal_place') as number) ?? 2;
  const stop = (player.getDynamicProperty('speed_show_s') as boolean) ?? false;

  const wailaShow = new ObservableBoolean(wailaStatus, {
    clientWritable: true,
  });
  const speedShow = new ObservableBoolean(speedStatus, {
    clientWritable: true,
  });
  const wellcomeShow = new ObservableBoolean(wellcome, {
    clientWritable: true,
  });
  const biomeFind = new ObservableBoolean(biome_find, { clientWritable: true });
  const updateFunctions = new ObservableNumber(updateInSeconds, {
    clientWritable: true,
  });
  const floatingPoint = new ObservableNumber(floating, {
    clientWritable: true,
  });
  const speedShowStop = new ObservableBoolean(stop, { clientWritable: true });
  const stopScore = new ObservableBoolean(speed_score, {
    clientWritable: true,
  });

  const form = new CustomForm(player, { translate: 'bs.title.quick_settings' });
  form
    .toggle({ translate: 'bs.toggle.waila_show.quick_settings' }, wailaShow)
    .toggle({ translate: 'bs.toggle.speed_show.quick_settings' }, speedShow)
    .toggle(
      { translate: 'bs.toggle.wellcome_show.quick_settings' },
      wellcomeShow,
    )
    .divider()
    .label({ translate: 'bs.label.definitions.quick_settings' })
    .spacer()
    .toggle({ translate: 'bs.toggle.biome_find.quick_settings' }, biomeFind)
    .slider(
      { translate: 'bs.slider.updatefunctions.quick_settings' },
      updateFunctions,
      0,
      50,
      {
        step: 1,
        description: 'Regulates the frequency at which functions are executed.',
      },
    )
    .spacer()
    .label({ translate: 'bs.label.speed_definitions.quick_settings' })
    .slider(
      { translate: 'bs.slider.floating-point.quick_settings' },
      floatingPoint,
      0,
      20,
      { step: 1 },
    )
    .toggle(
      { translate: 'bs.toggle.speed_show_stop.quick_settings' },
      speedShowStop,
    )
    .toggle({ translate: 'bs.toggle.stop_score.quick_settings' }, stopScore)
    .closeButton();

  await form.show();

  player.playSound('note.bell');

  player.setDynamicProperty('bs:waila_show', wailaShow.getData());
  player.setDynamicProperty('speed_show', speedShow.getData());
  player.setDynamicProperty('wellcome_show', wellcomeShow.getData());
  player.setDynamicProperty('ticks_per_seconds', updateFunctions.getData());
  player.setDynamicProperty('speed_decimal_place', floatingPoint.getData());
  player.setDynamicProperty('biome_hud_learning', biomeFind.getData());
  player.setDynamicProperty('speed_show_s', speedShowStop.getData());
  player.setDynamicProperty('speed_score', stopScore.getData());
};

const Comming = async (player: Player) => {
  const box = new MessageBox(player, { translate: 'bs.title.comming' });
  box
    .body({ translate: 'bs.body.comming' })
    .button1('§l§2Ok')
    .button2('§l§3Back');

  const r = await box.show();
  if (!r.selection) return;

  player.playSound('note.bell', { pitch: 1, volume: 0 });
  await Mycustom(player);
};

const Waila = async (player: Player) => {
  system.run(() => {
    player.runCommand('bs:waila');
  });
};

world.afterEvents.itemUse.subscribe(async (event) => {
  const { source, itemStack } = event;
  if (source instanceof Player && itemStack.typeId === 'bs:profile') {
    await Mycustom(source);
  }
});

system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    {
      name: 'bs:profile',
      description: 'A menu with options and settings.',
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin) => {
      const entity = origin.sourceEntity ?? origin.initiator;

      if (!entity || !(entity instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: 'This command can only be used by a player.',
        };
      }

      system.run(() => Mycustom(entity));
      return { status: CustomCommandStatus.Success };
    },
  );
});

// Default settings initialization
let NewData = [
  { id: 'waila_show', st: true },
  { id: 'speed_show', st: false },
  { id: 'wellcome_show', st: true },
];

NewData.forEach((item) => {
  DefaultSettings.set(item.id, item.st);
});
