import { Player,world } from '@minecraft/server';

export interface DynamicObjectWorld {
  id: string | undefined ;
  nameTag: string | undefined;
  status: string;
  [key: string]:any
}

export class DynamicDefinitionsWorld {
  public static list( propertyKey: string): DynamicObjectWorld[] {
    try {
      const rawData = world.getDynamicProperty(propertyKey) as
        | string
        | undefined;
      if (!rawData) return [];

      return JSON.parse(rawData) as DynamicObjectWorld[];
    } catch (e) {
      console.error(`Failed to read dynamic property '${propertyKey}':`, e);
      return [];
    }
  }

  private static remove(
    propertyKey: string,
    value: DynamicObjectWorld,
  ): void {
    try {
      const originData: DynamicObjectWorld[] = this.list(propertyKey);

      const updatedList = originData.filter(
        (item: DynamicObjectWorld) => item.id !== value.id,
      );

      const rawScheme: string = JSON.stringify(updatedList);
      world.setDynamicProperty(propertyKey, rawScheme);
    } catch (e) {
      console.error(
        `Failed to remove from dynamic property '${propertyKey}':`,
        e,
      );
    }
  }

  private static push(
    propertyKey: string,
    addValue: DynamicObjectWorld,
  ): void {
    try {
      const originData: DynamicObjectWorld[] = this.list( propertyKey);

      originData.push(addValue);

      const rawScheme: string = JSON.stringify(originData);
    world.setDynamicProperty(propertyKey, rawScheme);
    } catch (e) {
      console.error(`Failed to push to dynamic property '${propertyKey}':`, e);
    }
  }

  public static add(
    propertyKey: string,
    addValue: DynamicObjectWorld,
  ): void {
    this.push(propertyKey, addValue);
  }

  public static delete(
    propertyKey: string,
    value: DynamicObjectWorld,
  ): void {
    this.remove(propertyKey, value);
  }
}
