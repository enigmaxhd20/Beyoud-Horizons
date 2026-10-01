const loadSettingsScripts = async (): Promise<void> => {
  const scripts: string[] = [];
  let allLoaded = true;

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`script ${script} loaded`);
    } catch (error) {
      console.error(`script ${script} error loaded`, error);
      allLoaded = false;
    }
  }

  if (allLoaded) {
    console.warn("all script loaded");
  }
};

void loadSettingsScripts();