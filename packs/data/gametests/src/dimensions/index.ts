const loadDimensionScripts = async () => {
  const scripts: string[] = [
    "./test/main.js",
    "./custom_dim/index.js",
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

loadDimensionScripts();