import { world } from "@minecraft/server";

export class GameTime {
  private static readonly DAY_TICKS = 24000;
  private static readonly TICKS_PER_HOUR = 1000;
  private static readonly OFFSET_HOURS = 6; 


  static get ticks(): number {
    const d = this.DAY_TICKS;
    return ((world.getTimeOfDay() % d) + d) % d;
  }

  /** Hora (0-23). */
  static get hour(): number {
    return (Math.floor(this.ticks / this.TICKS_PER_HOUR) + this.OFFSET_HOURS) % 24;
  }

  /** Minuto (0-59). */
  static get minute(): number {
    return Math.floor(((this.ticks % this.TICKS_PER_HOUR) * 60) / this.TICKS_PER_HOUR);
  }

  /** Formato 24h: "HH:MM". */
  static format24h(): string {
    return `${String(this.hour).padStart(2, "0")}:${String(this.minute).padStart(2, "0")}`;
  }

  static format12h(): string {
    const h = this.hour % 12 || 12;
    const suffix = this.hour < 12 ? "AM" : "PM";
    return `${String(h).padStart(2, "0")}:${String(this.minute).padStart(2, "0")} ${suffix}`;
  }


  static fromTicks(ticks: number): string {
    const d = this.DAY_TICKS;
    const t = ((ticks % d) + d) % d;
    const h = (Math.floor(t / this.TICKS_PER_HOUR) + this.OFFSET_HOURS) % 24;
    const m = Math.floor(((t % this.TICKS_PER_HOUR) * 60) / this.TICKS_PER_HOUR);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  static get isDay(): boolean {
    return this.ticks < 12000;
  }
}