const loadSpawnItemScripts = async () => {
  const scripts: string[] = [
    "./items",
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded`);
    } catch (error) {
      console.error(`error importing ${script}`, error);
    }
  }
};

loadSpawnItemScripts();