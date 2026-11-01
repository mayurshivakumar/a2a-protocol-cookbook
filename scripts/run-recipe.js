const recipes = new Map([
  ['01', '../recipes/01-discovery-and-routing/index.js'],
  ['02', '../recipes/02-synchronous-exchange/index.js'],
  ['03', '../recipes/03-streaming-results/index.js'],
  ['04', '../recipes/04-long-running-multiturn/index.js'],
  ['05', '../recipes/05-task-control-and-recovery/index.js'],
  ['06', '../recipes/06-delegating-agent/index.js'],
  ['07', '../recipes/07-fanout-and-aggregation/index.js'],
  ['08', '../recipes/08-validation-and-refinement/index.js'],
  ['09', '../recipes/09-push-notifications/index.js'],
  ['10', '../recipes/10-external-service-adapter/index.js'],
  ['11', '../recipes/11-security-and-trust/index.js'],
])

async function run(recipeId) {
  const modulePath = recipes.get(recipeId)
  if (!modulePath) {
    throw new Error(
      `Unknown recipe "${recipeId}". Choose one of: ${[...recipes.keys()].join(', ')}`
    )
  }
  console.log(`\nRunning recipe ${recipeId}`)
  const recipe = await import(modulePath)
  await recipe.runDemo()
}

const selection = process.argv[2] ?? 'all'
if (selection === 'all') {
  for (const recipeId of recipes.keys()) {
    await run(recipeId)
  }
} else {
  await run(selection.padStart(2, '0'))
}
