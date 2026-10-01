const loadGuideScripts = async () => {
  const scripts: string[] = [
    "./profile.js",
    "./games.js",
    "./dimensions_create.js",
  ];

  let allLoaded: boolean = true;

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
    console.warn("all script loaded of guide");
  }
};

loadGuideScripts();