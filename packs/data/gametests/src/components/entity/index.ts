const loadEntityScripts = async ()=> {
  const scripts: string[] = [
    "./duck/duck.js",
    "./climb/index.js",
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded successfully`);
    } catch (error) {
      console.error(`${script} An error occurred.`, error);
    }
  }
};

loadEntityScripts();