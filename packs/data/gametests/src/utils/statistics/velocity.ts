import { system, world } from '@minecraft/server';
try {
  const SCOREBOARD_ID = 'statistics';
  const SCOREBOARD_NAME = 'Velocity';
  const TICK_RATE = 20;

  const afterWorldEvents = world.afterEvents as any;

  afterWorldEvents.worldLoad?.subscribe(() => {
    const objective =
      world.scoreboard.getObjective(SCOREBOARD_ID) ??
      world.scoreboard.addObjective(SCOREBOARD_ID, SCOREBOARD_NAME);

    console.warn('Speed recording event activated');

    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        const showVelocity = player.getDynamicProperty('speed_show') ?? false;
        const showSecondary =
          player.getDynamicProperty('speed_show_s') ?? false;
        const decimalPlaces = Number(
          player.getDynamicProperty('speed_decimal_place') ?? 2,
        );
        const useScoreboard = player.getDynamicProperty('speed_score') ?? false;

        if (!showVelocity && !showSecondary) {
          continue;
        }

        const velocity = player.getVelocity();
        const speed = Math.sqrt(
          velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2,
        );

        if (speed <= 0.001) {
          continue;
        }

        const formattedSpeed = speed.toFixed(decimalPlaces);
        const scoreValue = Number(formattedSpeed);

        if (useScoreboard) {
          objective.addScore(player, scoreValue);
          continue;
        }

        player.onScreenDisplay.setActionBar(formattedSpeed);
      }
    }, TICK_RATE);
  });
} catch (error) {
  console.error('Error initializing velocity statistics:', error);
}
