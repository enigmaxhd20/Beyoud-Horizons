const loadSettings = async () => {
  let scripts = [
    "./default_settings.js"
  ];
  for (const script of scripts) {
    try {
      await import(script)
      console.log(`${script} loaded successfully `);
    } catch (e) {
      console.error(`error importing ${script}`, e);
    }
  }
}

loadSettings();