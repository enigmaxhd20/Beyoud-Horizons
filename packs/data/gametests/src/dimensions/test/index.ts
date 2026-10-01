const dimensionsAsync = async ()=> {
  let scripts: string[] = ["./main.js"];
  for (const script of scripts) {
    try {
      await import(script)
      console.log(`${script} loaded`)
    } catch (e) {
      console.error(`Failed to load ${script}`, e)
    }
  }
}
dimensionsAsync()