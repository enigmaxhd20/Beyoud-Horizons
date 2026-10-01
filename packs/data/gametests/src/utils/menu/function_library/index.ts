const loadFunctionLibraryScripts = async () => {
  const scripts: string[] = [
    "./tp.js",
    "./commands.js",
  ];

  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded successfully`);
    } catch (error) {
      console.error("error importing function library script", error);
    }
  }
};

loadFunctionLibraryScripts();