const loadCommandScripts = async ()=> {
  const scripts: string[] = [
    "./radom_code.js"
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded successfully`);
    } catch (error) {
      console.error(`error importing ${script}`, error);
    }
  }
};

loadCommandScripts();