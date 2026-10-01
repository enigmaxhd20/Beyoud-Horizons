	(async () => {
  let scripts = [
    "./blocks.js"
  ];
  for (const script of scripts) {
    try {
      await import(script)
      console.log(`${script} loaded`)
    } catch (e) {
      console.error(`error importing ${script}`, e)
    }
  }
})()