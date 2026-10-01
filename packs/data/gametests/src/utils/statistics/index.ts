(async () => {
  let scripts = [
    "./velocity.js"
  ]
  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded`);
    } catch (e) {
      console.error(` loaded ${script}`, e);
    }
  }
})();