import { world, system } from '@minecraft/server';
export class randomNumber {
  private static creater(length: number = 8): string {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters.charAt(randomIndex);
    }
    return result;
  }
  public static getRandomCode(idx) {
   try {
     let result = this.creater(idx)
     return result
   } catch (e) {
     console.error(e)
     return undefined
   }
  }
}
