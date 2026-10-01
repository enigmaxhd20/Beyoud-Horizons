export{}
const loadComponentScripts = async (): Promise<void> => {
  const scripts: string[] = [
  "./random_code/index.js"
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
