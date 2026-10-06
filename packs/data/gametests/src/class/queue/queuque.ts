import {
  world,
  system,
  Player,
  PlayerLeaveAfterEvent,
  PlayerSpawnAfterEvent,
  TitleDisplayOptions,
} from "@minecraft/server";

/** Value that can be displayed on a panel. */
export type PanelValue = string | number;

/**
 * Priority levels. Higher number = sent first.
 */
export enum Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/** Accepts the enum or any custom number. */
export type PriorityLevel = Priority | number;

/**
 * A single message that will be sent to the HUD through the title channel.
 * Change `message.priority` while it is still pending and the queue
 * will respect the new value on the next send.
 */
export class PanelMessage {
  public readonly prefix: string;
  public readonly createdAt: number;
  public value: string;
  public priority: PriorityLevel;

  constructor(
    prefix: string,
    value: PanelValue,
    priority: PriorityLevel = Priority.NORMAL
  ) {
    this.prefix = prefix;
    this.value = String(value);
    this.priority = priority;
    this.createdAt = system.currentTick;
  }

  /** Final text sent to the UI (prefix + value). */
  public get text(): string {
    return `${this.prefix}${this.value}`;
  }
}

/**
 * Per-player queue. Sends ONE message every `interval` ticks,
 * always picking the pending message with the highest `.priority`.
 * Messages with the same priority are sent oldest first (FIFO).
 */
export class PanelQueue {
  private static readonly queues: Map<string, PanelQueue> = new Map();
  private static started: boolean = false;

  private static readonly titleOptions: TitleDisplayOptions = {
    fadeInDuration: 0,
    stayDuration: 2, // short: the UI already preserves the text
    fadeOutDuration: 0,
  };

  /** Ticks between each send (2-3 is the minimum safe value). */
  public static interval: number = 3;

  /** prefix -> pending message */
  private readonly pending: Map<string, PanelMessage> = new Map();
  /** prefix -> last message sent */
  private readonly sent: Map<string, PanelMessage> = new Map();

  private constructor(public readonly player: Player) {}

  /** Get (or create) the queue of a player. */
  public static for(player: Player): PanelQueue {
    let queue: PanelQueue | undefined = PanelQueue.queues.get(player.id);
    if (!queue) {
      queue = new PanelQueue(player);
      PanelQueue.queues.set(player.id, queue);
    }
    PanelQueue.start();
    return queue;
  }

  /** Starts the global processor and cleanup events (runs only once). */
  private static start(): void {
    if (PanelQueue.started) return;
    PanelQueue.started = true;

    system.runInterval((): void => {
      for (const player of world.getAllPlayers()) {
        PanelQueue.queues.get(player.id)?.flushOne();
      }
    }, PanelQueue.interval);

    world.afterEvents.playerLeave.subscribe(
      ({ playerId }: PlayerLeaveAfterEvent): void => {
        PanelQueue.queues.delete(playerId);
      }
    );

    // The UI state is lost on reconnect, so resend everything.
    world.afterEvents.playerSpawn.subscribe(
      ({ player, initialSpawn }: PlayerSpawnAfterEvent): void => {
        if (initialSpawn) PanelQueue.for(player).resendAll();
      }
    );
  }

  /**
   * Adds a message to the queue.
   * A pending message with the same prefix is replaced (only the latest matters).
   * Returns the message so you can change `.priority` afterwards.
   *
   * @returns null if the value is already on screen
   */
  public enqueue(
    prefix: string,
    value: PanelValue,
    priority: PriorityLevel = Priority.NORMAL
  ): PanelMessage | null {
    const last: PanelMessage | undefined = this.sent.get(prefix);
    if (last && last.value === String(value)) {
      this.pending.delete(prefix);
      return null;
    }

    const message: PanelMessage = new PanelMessage(prefix, value, priority);
    this.pending.set(prefix, message);
    return message;
  }

  /** Number of messages waiting to be sent. */
  public get pendingCount(): number {
    return this.pending.size;
  }

  /** Forces a prefix to be sent again even if the value did not change. */
  public invalidate(prefix: string): void {
    this.sent.delete(prefix);
  }

  /** Discards every pending message (already sent ones stay on screen). */
  public clear(): void {
    this.pending.clear();
  }

  /** Marks everything as not sent, so it is sent again. */
  public resendAll(): void {
    for (const message of this.sent.values()) {
      this.pending.set(message.prefix, message);
    }
    this.sent.clear();
  }

  /** The pending message that will be sent next (highest priority, then oldest). */
  public peek(): PanelMessage | null {
    let best: PanelMessage | null = null;
    for (const message of this.pending.values()) {
      if (
        best === null ||
        message.priority > best.priority ||
        (message.priority === best.priority && message.createdAt < best.createdAt)
      ) {
        best = message;
      }
    }
    return best;
  }

  /** Sends the next message, if any. */
  private flushOne(): void {
    const message: PanelMessage | null = this.peek();
    if (message === null) return;

    this.pending.delete(message.prefix);
    this.sent.set(message.prefix, message);

    try {
      this.player.onScreenDisplay.setTitle(message.text, PanelQueue.titleOptions);
    } catch (error: unknown) {
      // Player may be unloaded or disconnected; put it back to try later.
      this.sent.delete(message.prefix);
      this.pending.set(message.prefix, message);
    }
  }
}

// ---------------------------------------------------------------
// Usage example
// ---------------------------------------------------------------
// const queue: PanelQueue = PanelQueue.for(player);
//
// queue.enqueue("coins:", 150);                          // NORMAL
// queue.enqueue("nivel:", 7, Priority.LOW);              // sent after the others
// queue.enqueue("biome_find:", "Plains", Priority.HIGH); // sent first
//
// const msg: PanelMessage | null = queue.enqueue("alert:", "Low health!");
// if (msg) msg.priority = Priority.CRITICAL;