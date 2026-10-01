const loadSpawnScripts = async () => {
  const scripts: string[] = [
    "./items/index.js"
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

loadSpawnScripts();