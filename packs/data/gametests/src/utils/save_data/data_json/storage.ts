import { world, Player, Entity, ItemStack } from "@minecraft/server";

type RecordLike = Record<string, unknown>;

  const toJson = <T>(value: T): string => JSON.stringify(value);

  const fromJson = <T>(raw: unknown, fallback: T | null): T | null => {
    if (typeof raw !== "string") {
      return fallback;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const ensureArray = <T>(value: T[] | null | undefined): T[] => {
    return Array.isArray(value) ? value : [];
  };

  const mergeData = <T extends RecordLike>(base: T | null | undefined, next: Partial<T>): T => {
    return { ...(base ?? {}), ...next } as T;
  };

  export class EntityData {
    static set<T>(entity: Entity, id: string, value: T): boolean {
      try {
        entity.setDynamicProperty(id, toJson(value));
        return true;
      } catch (error) {
        console.error(`[EntityData] failed to save '${id}' in the entity:`, error);
        return false;
      }
    }

    static get<T = unknown>(entity: Entity, id: string, fallback: T | null = null): T | null {
      try {
        return fromJson<T>(entity.getDynamicProperty(id), fallback);
      } catch (error) {
        console.warn(`[EntityData] the id '${id}' is corrupted within the entity.`);
        return fallback;
      }
    }

    static update<T extends RecordLike>(entity: Entity, id: string, newData: Partial<T>): boolean {
      try {
        const oldData = this.get<T>(entity, id, {} as T);
        return this.set(entity, id, mergeData(oldData, newData));
      } catch (error) {
        console.error(`error updating ${id} of ${entity}`, error);
        return false;
      }
    }

    static getNamesFromList<T extends { name?: string }>(entity: Entity, id: string, fallback: string[] | null = null): string[] | null {
      try {
        const list = ensureArray(this.get<T[]>(entity, id, []));
        return list.map((item) => item.name ?? "");
      } catch {
        return fallback;
      }
    }

    static getAllId<T extends { id?: string | number }>(entity: Entity, id: string, fallback: Array<string | number> | null = null): Array<string | number> | null {
      try {
        const list = ensureArray(this.get<T[]>(entity, id, []));
        return list.map((item) => item.id ?? "");
      } catch {
        return fallback;
      }
    }

    static getValueByProperty<T extends RecordLike>(entity: Entity, id: string, searchKey: keyof T, searchValue: unknown, resultKey?: keyof T, fallback: unknown = null): unknown {
      try {
        const data = ensureArray(this.get<T[]>(entity, id, []));
        const found = data.find((item) => item[searchKey] === searchValue);
        if (!found) return null;
        return resultKey ? found[resultKey] : found;
      } catch {
        return fallback;
      }
    }

    static getIdByName<T extends { name?: string; id?: string | number }>(entity: Entity, id: string, name: string, fallback: string | number | null = null): string | number | null {
      try {
        const list = ensureArray(this.get<T[]>(entity, id, []));
        const found = list.find((item) => item.name === name);
        return found ? (found.id ?? null) : null;
      } catch {
        return fallback;
      }
    }

    static add<T>(entity: Entity, id: string, newObject: T): void {
      try {
        const list = ensureArray(this.get<T[]>(entity, id, []));
        list.push(newObject);
        this.set(entity, id, list);
      } catch (error) {
        console.error(`error adding ${newObject}`, error);
      }
    }

    static getIdsByPrefix(entity: Entity, prefix: string): string[] {
      try {
        const allIds = entity.getDynamicPropertyIds();
        return allIds.filter((id) => id.startsWith(prefix));
      } catch (error) {
        console.error("[EntityData] Error listing entity IDs.", error);
        return [];
      }
    }

    static delete(entity: Entity, id: string): boolean {
      try {
        entity.setDynamicProperty(id, undefined);
        return true;
      } catch (error) {
        console.error(`Error deleting ${id} of ${entity}`, error);
        return false;
      }
    }

    static deleteAll(entity: Entity): void {
      try {
        entity.clearDynamicProperties();
      } catch (error) {
        console.error("Error clearing dynamic properties.", error);
      }
    }
  }

  export class WorldData {
    static set<T>(id: string, value: T): boolean {
      try {
        world.setDynamicProperty(id, toJson(value));
        return true;
      } catch (error) {
        console.error(`[WorldData] failed to save ${id}`, error);
        return false;
      }
    }

    static get<T = unknown>(id: string, fallback: T | null = null): T | null {
      try {
        return fromJson<T>(world.getDynamicProperty(id), fallback);
      } catch (error) {
        console.error(`[WorldData] error accessing ${id}`, error);
        return fallback;
      }
    }

    static update<T extends RecordLike>(id: string, newData: Partial<T>): boolean {
      try {
        const oldData = this.get<T>(id, {} as T);
        return this.set(id, mergeData(oldData, newData));
      } catch (error) {
        console.error(`error updating ${id}`, error);
        return false;
      }
    }

    static getNamesFromList<T extends { name?: string }>(id: string, fallback: string[] | null = null): string[] | null {
      try {
        const list = ensureArray(this.get<T[]>(id, []));
        return list.map((item) => item.name ?? "");
      } catch {
        return fallback;
      }
    }

    static getAllId<T extends { id?: string | number }>(id: string, fallback: Array<string | number> | null = null): Array<string | number> | null {
      try {
        const list = ensureArray(this.get<T[]>(id, []));
        return list.map((item) => item.id ?? "");
      } catch {
        return fallback;
      }
    }

    static getIdsByPrefix(prefix: string): string[] {
      try {
        const allIds = world.getDynamicPropertyIds();
        return allIds.filter((id) => id.startsWith(prefix));
      } catch (error) {
        console.error(`[WorldData] Error listing ${prefix}`, error);
        return [];
      }
    }

    static getByInitialLetter<T extends RecordLike>(id: string, letter: string, searchKey: keyof T): T[] {
      try {
        const list = ensureArray(this.get<T[]>(id, []));
        return list.filter((item) => {
          const key = item[searchKey];
          return typeof key === "string" && key.toLowerCase().startsWith(letter.toLowerCase());
        });
      } catch {
        console.error(`Error searching initial letter in ID ${id}`);
        return [];
      }
    }

    static getIdByName<T extends { name?: string; id?: string | number }>(id: string, name: string, fallback: string | number | null = null): string | number | null {
      try {
        const list = ensureArray(this.get<T[]>(id, []));
        const found = list.find((item) => item.name === name);
        return found ? (found.id ?? null) : null;
      } catch {
        return fallback;
      }
    }

    static getValueByProperty<T extends RecordLike>(id: string, searchKey: keyof T, searchValue: unknown, resultKey?: keyof T, fallback: unknown = null): unknown {
      try {
        const data = ensureArray(this.get<T[]>(id, []));
        const found = data.find((item) => item[searchKey] === searchValue);
        if (!found) return null;
        return resultKey ? found[resultKey] : found;
      } catch {
        return fallback;
      }
    }

    static add<T>(id: string, newObject: T): void {
      try {
        const list = ensureArray(this.get<T[]>(id, []));
        list.push(newObject);
        this.set(id, list);
      } catch (error) {
        console.error(`error adding ${newObject}`, error);
      }
    }

    static delete(id: string): boolean {
      try {
        world.setDynamicProperty(id, undefined);
        return true;
      } catch (error) {
        console.error(`It was not possible to delete the ${id}`, error);
        return false;
      }
    }

    static deleteAll(): void {
      try {
        world.clearDynamicProperties();
      } catch (error) {
        console.error("Error deleting all global dynamic properties.", error);
      }
    }
  }

  export class ItemData {
    static set<T>(item: ItemStack, id: string, value: T): boolean {
      try {
        item.setDynamicProperty(id, toJson(value));
        return true;
      } catch (error) {
        console.error(`[ItemData] failed to save '${id}'`, error);
        return false;
      }
    }

    static get<T = unknown>(item: ItemStack, id: string, fallback: T | null = null): T | null {
      try {
        return fromJson<T>(item.getDynamicProperty(id), fallback);
      } catch (error) {
        console.warn(`[ItemData] the id '${id}' is corrupted within the item.`);
        return fallback;
      }
    }

    static update<T extends RecordLike>(item: ItemStack, id: string, newData: Partial<T>): boolean {
      try {
        const oldData = this.get<T>(item, id, {} as T);
        return this.set(item, id, mergeData(oldData, newData));
      } catch (error) {
        console.error(`error updating ${id}`, error);
        return false;
      }
    }

    static getNamesFromList<T extends { name?: string }>(item: ItemStack, id: string, fallback: string[] | null = null): string[] | null {
      try {
        const list = ensureArray(this.get<T[]>(item, id, []));
        return list.map((entry) => entry.name ?? "");
      } catch {
        return fallback;
      }
    }

    static getAllId<T extends { id?: string | number }>(item: ItemStack, id: string, fallback: Array<string | number> | null = null): Array<string | number> | null {
      try {
        const list = ensureArray(this.get<T[]>(item, id, []));
        return list.map((entry) => entry.id ?? "");
      } catch {
        return fallback;
      }
    }

    static getIdByName<T extends { name?: string; id?: string | number }>(item: ItemStack, id: string, name: string, fallback: string | number | null = null): string | number | null {
      try {
        const list = ensureArray(this.get<T[]>(item, id, []));
        const found = list.find((entry) => entry.name === name);
        return found ? (found.id ?? null) : null;
      } catch {
        return fallback;
      }
    }

    static getValueByProperty<T extends RecordLike>(item: ItemStack, id: string, searchKey: keyof T, searchValue: unknown, resultKey?: keyof T, fallback: unknown = null): unknown {
      try {
        const data = ensureArray(this.get<T[]>(item, id, []));
        const found = data.find((entry) => entry[searchKey] === searchValue);
        if (!found) return null;
        return resultKey ? found[resultKey] : found;
      } catch {
        return fallback;
      }
    }

    static add<T>(item: ItemStack, id: string, newObject: T): void {
      try {
        const list = ensureArray(this.get<T[]>(item, id, []));
        list.push(newObject);
        this.set(item, id, list);
      } catch (error) {
        console.error(`error adding ${newObject}`, error);
      }
    }

    static getIdsByPrefix(item: ItemStack, prefix: string): string[] {
      try {
        const allIds = item.getDynamicPropertyIds();
        return allIds.filter((id) => id.startsWith(prefix));
      } catch (error) {
        console.error("[ItemData] Error listing item", error);
        return [];
      }
    }

    static delete(item: ItemStack, id: string): boolean {
      try {
        item.setDynamicProperty(id, undefined);
        return true;
      } catch (error) {
        console.error(`Error deleting ${id}`, error);
        return false;
      }
    }

    static deleteAll(item: ItemStack): void {
      try {
        item.clearDynamicProperties();
      } catch (error) {
        console.error("Error clearing dynamic properties.", error);
      }
    }
  }

  export class PlayerData {
    static set<T>(player: Player, id: string, value: T): boolean {
      try {
        player.setDynamicProperty(id, toJson(value));
        return true;
      } catch (error) {
        console.error(`[PlayerData] failed to save '${id}' in the player:`, error);
        return false;
      }
    }

    static get<T = unknown>(player: Player, id: string, fallback: T | null = null): T | null {
      try {
        return fromJson<T>(player.getDynamicProperty(id), fallback);
      } catch (error) {
        console.warn(`[PlayerData] the id '${id}' is corrupted within ${player.nameTag}`);
        return fallback;
      }
    }

    static update<T extends RecordLike>(player: Player, id: string, newData: Partial<T>): boolean {
      try {
        const oldData = this.get<T>(player, id, {} as T);
        return this.set(player, id, mergeData(oldData, newData));
      } catch (error) {
        console.error(`error updating ${id} of ${player.nameTag}`, error);
        return false;
      }
    }

    static getNamesFromList<T extends { name?: string }>(player: Player, id: string, fallback: string[] | null = null): string[] | null {
      try {
        const list = ensureArray(this.get<T[]>(player, id, []));
        return list.map((entry) => entry.name ?? "");
      } catch {
        return fallback;
      }
    }

    static getAllId<T extends { id?: string | number }>(player: Player, id: string, fallback: Array<string | number> | null = null): Array<string | number> | null {
      try {
        const list = ensureArray(this.get<T[]>(player, id, []));
        return list.map((entry) => entry.id ?? "");
      } catch {
        return fallback;
      }
    }

    static getValueByProperty<T extends RecordLike>(player: Player, id: string, searchKey: keyof T, searchValue: unknown, resultKey?: keyof T, fallback: unknown = null): unknown {
      try {
        const data = ensureArray(this.get<T[]>(player, id, []));
        const found = data.find((entry) => entry[searchKey] === searchValue);
        if (!found) return null;
        return resultKey ? found[resultKey] : found;
      } catch {
        return fallback;
      }
    }

    static getIdByName<T extends { name?: string; id?: string | number }>(player: Player, id: string, name: string, fallback: string | number | null = null): string | number | null {
      try {
        const list = ensureArray(this.get<T[]>(player, id, []));
        const found = list.find((entry) => entry.name === name);
        return found ? (found.id ?? null) : null;
      } catch {
        return fallback;
      }
    }

    static add<T>(player: Player, id: string, newObject: T): void {
      try {
        const list = ensureArray(this.get<T[]>(player, id, []));
        list.push(newObject);
        this.set(player, id, list);
      } catch (error) {
        console.error(`error adding ${newObject}`, error);
      }
    }

    static getIdsByPrefix(player: Player, prefix: string): string[] {
      try {
        const allIds = player.getDynamicPropertyIds();
        return allIds.filter((id) => id.startsWith(prefix));
      } catch (error) {
        console.error("[PlayerData] Error listing player properties.", error);
        return [];
      }
    }

    static delete(player: Player, id: string): boolean {
      try {
        player.setDynamicProperty(id, undefined);
        return true;
      } catch (error) {
        console.error(`Error deleting ${id} of ${player.nameTag}`, error);
        return false;
      }
    }

    static deleteAll(player: Player): void {
      try {
        player.clearDynamicProperties();
      } catch (error) {
        console.error("Error deleting dynamic properties.", error);
      }
    }
  }