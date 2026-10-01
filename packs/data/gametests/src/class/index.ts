(async () => {
  const scripts: string[] = ['./worldClock/index.js', './queuque/index.js'];

  let allScriptsLoaded = true;

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded successfully`);
    } catch (error) {
      console.error(`Error importing ${script}:`, error);
      allScriptsLoaded = false;
    }
  }

  if (allScriptsLoaded) {
    console.warn('All main.js scripts loaded successfully');
  } else {
    console.error('main.js scripts loading failed');
  }
})();
