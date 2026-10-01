const loadWaterScripts = async () => {
  const scripts: string[] = [
    "./thirst.js",
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded`);
    } catch (error) {
      console.error(`Error importing this script ${script}`, error);
    }
  }
};

loadWaterScripts();