	(async () => {
  let scripts = [
    "./function_library/index.js",
    "./guide/index.js",
    "./settings/index.js",
  ];
  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded`)
    } catch (e) {
      console.error(`${script} load error:`, e);
    }
  }
})();