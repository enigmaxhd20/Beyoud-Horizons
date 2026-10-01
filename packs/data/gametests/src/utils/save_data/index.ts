(async () => {
  let scripts = [
    "./data_json/storage.js"
  ];
  for (const script of scripts) {
    try {
      await import(script)
      console.log(`script ${script} loaded`)
    } catch (e) {
      console.error(`It was not possible to import ${script}`, e)
    }
  }
})()