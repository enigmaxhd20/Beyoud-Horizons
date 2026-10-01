export {};
const importAddFriend = async (): Promise<void> => {
  var scripts: string[] = ['./addFrieds.js'];
  for (const script of scripts) {
    try {
      await import(script);
      console.log(`script${script} loaded`);
    } catch (e) {
      console.error(`script${script}falied`, e);
    }
  }
};
void importAddFriend();
