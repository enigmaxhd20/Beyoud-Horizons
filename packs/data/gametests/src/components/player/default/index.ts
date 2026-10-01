const loadDynamicScripts = async () => {
  const scripts: string[] = [
    "./settings/index.js",
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded successfully`);
    } catch (error) {
      console.error(`error importing ${script}`, error);
    }
  }
};

loadDynamicScripts();