import { Player } from '@minecraft/server';

export interface DynamicObject {
  id: string;
  nameTag: string;
  status: string | undefined;
}

export class DynamicDefinitions {
  public static list(player: Player, propertyKey: string): DynamicObject[] {
    try {
      const rawData = player.getDynamicProperty(propertyKey) as
        | string
        | undefined;
      if (!rawData) return [];

      return JSON.parse(rawData) as DynamicObject[];
    } catch (e) {
      console.error(`Failed to read dynamic property '${propertyKey}':`, e);
      return [];
    }
  }

  private static remove(
    player: Player,
    propertyKey: string,
    value: DynamicObject,
  ): void {
    try {
      const originData: DynamicObject[] = this.list(player, propertyKey);

      const updatedList = originData.filter(
        (item: DynamicObject) => item.id !== value.id,
      );

      const rawScheme: string = JSON.stringify(updatedList);
      player.setDynamicProperty(propertyKey, rawScheme);
    } catch (e) {
      console.error(
        `Failed to remove from dynamic property '${propertyKey}':`,
        e,
      );
    }
  }

  private static push(
    player: Player,
    propertyKey: string,
    addValue: DynamicObject,
  ): void {
    try {
      const originData: DynamicObject[] = this.list(player, propertyKey);

      originData.push(addValue);

      const rawScheme: string = JSON.stringify(originData);
      player.setDynamicProperty(propertyKey, rawScheme);
    } catch (e) {
      console.error(`Failed to push to dynamic property '${propertyKey}':`, e);
    }
  }

  public static add(
    player: Player,
    propertyKey: string,
    addValue: DynamicObject,
  ): void {
    this.push(player, propertyKey, addValue);
  }

  public static delete(
    player: Player,
    propertyKey: string,
    value: DynamicObject,
  ): void {
    this.remove(player, propertyKey, value);
  }
}
