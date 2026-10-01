export{}
const loadComponentScripts = async (): Promise<void> => {
  const scripts: string[] = [
    "./death.js",
    "./statistics.js",
    "./spawn/index.js",
    "./default/index.js",
    "./friends/index.js"
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

void loadComponentScripts();
