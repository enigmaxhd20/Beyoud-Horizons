export{}
const loadCommandScripts = async () => {
  const scripts: string[] = [
    "./tpl/index.js",
    "./property/index.js",
    "./generation/index.js"
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