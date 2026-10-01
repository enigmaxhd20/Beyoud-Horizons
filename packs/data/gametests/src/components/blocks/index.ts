const loadBlockScripts = async () => {
  const scripts: string[] = [
    "./crops/index.js",
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
loadBlockScripts();