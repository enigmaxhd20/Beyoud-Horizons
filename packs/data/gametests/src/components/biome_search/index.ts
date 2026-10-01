(async () => {
  let scripts = [
    "./biome_player_search.js"
  ]
  for (const script of scripts) {
    try {
      await import(script);
      console.log(`${script} loaded`)
    } catch (e) {
      console.error(`Error importing this script ${script}`, e)
    }
  }
}
)()