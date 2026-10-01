import { system, world } from "@minecraft/server";

export interface ScriptWatchdogOptions {
    /** Time without a heartbeat before a hang is reported (ms). Default: 5000. */
    timeoutMs?: number;
    /** How often the watchdog checks the heartbeat (ticks). Default: 20 (1s). */
    checkIntervalTicks?: number;
    /** Minimum time between two hang triggers (ms). Default: same as timeoutMs. */
    cooldownMs?: number;
    /** Broadcast a chat message on hang. Default: true. */
    announce?: boolean;
    /** Custom logger. Default: console. */
    logger?: Pick<Console, "warn" | "error">;
}

export class ScriptWatchdog {
    private readonly timeoutMs: number;
    private readonly checkIntervalTicks: number;
    private readonly cooldownMs: number;
    private readonly announce: boolean;
    private readonly logger: Pick<Console, "warn" | "error">;

    private lastHeartbeat = Date.now();
    private lastTrigger = 0;
    private intervalId?: number;
    private hangCount = 0;

    constructor(options: ScriptWatchdogOptions = {}) {
        const {
            timeoutMs = 5000,
            checkIntervalTicks = 20,
            cooldownMs = timeoutMs,
            announce = true,
            logger = console,
        } = options;

        if (timeoutMs <= 0) throw new RangeError("timeoutMs must be greater than 0");
        if (checkIntervalTicks < 1) throw new RangeError("checkIntervalTicks must be at least 1");

        this.timeoutMs = timeoutMs;
        this.checkIntervalTicks = checkIntervalTicks;
        this.cooldownMs = cooldownMs;
        this.announce = announce;
        this.logger = logger;
    }

    /** Whether the watchdog is currently monitoring. */
    public get running(): boolean {
        return this.intervalId !== undefined;
    }

    /** Total number of hangs detected since the last `start()`. */
    public get hangs(): number {
        return this.hangCount;
    }

    /** Signals that the monitored task is alive. Call it from your main loop. */
    public feed(): void {
        this.lastHeartbeat = Date.now();
    }

    /**
     * Starts monitoring. Does nothing if already running.
     * @param onHang Called when no heartbeat was received within the timeout.
     * Receives the elapsed time (ms) since the last heartbeat.
     */
    public start(onHang: (elapsedMs: number) => void): void {
        if (this.running) {
            this.logger.warn("[Watchdog] Already running; start() ignored.");
            return;
        }

        this.hangCount = 0;
        this.lastTrigger = 0;
        this.feed();

        this.intervalId = system.runInterval(() => {
            const now = Date.now();
            const elapsed = now - this.lastHeartbeat;

            if (elapsed <= this.timeoutMs) return;
            if (now - this.lastTrigger < this.cooldownMs) return;

            this.lastTrigger = now;
            this.hangCount++;
            this.handleHang(elapsed, onHang);
        }, this.checkIntervalTicks);
    }

    /** Stops monitoring. Safe to call multiple times. */
    public stop(): void {
        if (this.intervalId === undefined) return;
        system.clearRun(this.intervalId);
        this.intervalId = undefined;
    }

    private handleHang(elapsedMs: number, onHang: (elapsedMs: number) => void): void {
        const seconds = (elapsedMs / 1000).toFixed(1);
        this.logger.warn(`[Watchdog] No heartbeat for ${seconds}s (hang #${this.hangCount}).`);

        if (this.announce) {
            try {
                world.sendMessage(`§c[Watchdog] Task unresponsive for ${seconds}s. Triggering recovery...`);
            } catch (error) {
                // sendMessage can throw in restricted execution contexts
                this.logger.error("[Watchdog] Failed to send chat message:", error);
            }
        }

        try {
            onHang(elapsedMs);
        } catch (error) {
            this.logger.error("[Watchdog] Recovery callback threw:", error);
        } finally {
            // Restart the heartbeat window so recovery gets a full timeout to succeed
            this.feed();
        }
    }
}