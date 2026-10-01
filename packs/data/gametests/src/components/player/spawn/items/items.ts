import { world, system, Player } from '@minecraft/server';
import { randomNumber } from '../../../generation/random_code/generation';
try {
  world.afterEvents.playerSpawn.subscribe((eventData) => {
    const player = eventData.player as Player;
    const { x, y, z } = player.location;
    const locationPlayer = `${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)}`;
    const colorLocation = player.getDynamicProperty('colorLocation') ?? '§5';
    const spawnMessage = `${player.name ?? 'Player'} has spawned! in ${colorLocation}${locationPlayer}`;
    player.sendMessage?.(spawnMessage);
    player.setDynamicProperty('user_id', randomNumber.getRandomCode(10));
    player.runCommand(
      '/execute as @s[hasitem={item=bs:profile,quantity=..1}] run give @s bs:profile',
    );
  });
} catch (error) {
  system.run(() => {
    console.error('Error in player spawn event:', error);
  });
}
