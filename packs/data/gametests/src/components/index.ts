const loadComponentScripts = async (): Promise<void> => {
  const scripts: string[] = [
    "./records/index.js",
    "./waila/main.js",
    "./biome_search/index.js",
    "./ui_queue/main.js",
    "./player/index.js",
    "./generation/index.js"
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