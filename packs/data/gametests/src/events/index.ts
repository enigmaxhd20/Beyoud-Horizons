const loadEventScripts = async () => {
  const scripts: string[] = [
    
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

loadEventScripts();