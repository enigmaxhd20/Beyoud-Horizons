const loadUtilsScripts = async () => {
  const scripts: string[] = [
    "./menu/index.js",
    "./save_data/index.js",
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

loadUtilsScripts();
