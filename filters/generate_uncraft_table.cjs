#!/usr/bin/env node
/**
 * Regolith filter that generates native uncraft recipes from the add-on's
 * existing recipes. Each generated file is a real recipe_shaped recipe: it
 * consumes one crafted item and returns a reduced quantity of an ingredient.
 * Output is written directly to BP, preserving the source recipe's directory
 * structure.
 *
 * A native recipe can return only ONE result item. Therefore, an original
 * recipe with N distinct ingredients generates N uncraft files, one per
 * ingredient. Players choose which material to recover, just as they would
 * choose any other recipe at a crafting table.
 *
 * IMPORTANT: Bedrock may emit "Adding duplicate crafting_table recipe"
 * warnings. When a crafted item has two or more distinct ingredients, this
 * filter generates multiple uncraft recipes that consume the same crafted
 * item and return different materials. Bedrock warns (but does not error)
 * when crafting-table recipes accept the same input and produce different
 * outputs. This is EXPECTED and intentional: it lets players choose which
 * material to recover. See `maxIngredientsPerCraftedItem` below to reduce
 * the number of competing recipes and related log warnings.
 *
 * Filter behavior:
 * 1. Reads both Bedrock crafting-table formats: "minecraft:recipe_shaped"
 *    (pattern/key) and "minecraft:recipe_shapeless" (ingredients list).
 * 2. Uses an allowlist, not a denylist: a recipe is eligible only when ALL
 *    its tags are included in `allowedTags` (by default, only
 *    ["crafting_table"]). Furnace, smoker, stonecutter, smithing, loom,
 *    cartography, brewing, and mixed-tag recipes are excluded. New recipe
 *    station tags are excluded by default as well.
 * 3. Skips self-referencing ingredients. Tag ingredients are counted and
 *    skipped only when neither `tagDefaults` nor generic wood recognition
 *    can resolve them to one concrete item.
 * 4. Returned quantities are integers between `minPerIngredient` and
 *    `maxPerIngredient`, so generated `count` values are valid.
 * 5. Builds generated identifiers from the original recipe identifier when
 *    available, preventing collisions between recipes with the same result.
 * 6. Logs skip reasons separately for easier auditing.
 * 7. Removes obsolete files named with `.uncraft.` outside `outputDir` when
 *    `cleanupStrayFiles` is enabled.
 * 8. Chooses canonical wood variants based first on resolved ingredients
 *    (for example, `minecraft:oak_planks`), then on filenames/identifiers.
 * 9. Inherits the original recipe's `format_version` and `unlock` block when
 *    present; otherwise it uses the configured fallback and `unlockOn`.
 * 10. Scans directories asynchronously, reads sibling directories in
 *     parallel, follows directory symlinks, and continues after a directory
 *     read error. `maxDepth` can limit recursion.
 * 11. `recipesDir` accepts one path or an array of paths. Results are
 *     combined, and the common directory structure is preserved in output.
 * 12. Generic wood tags (such as `planks`) can be inferred by tag name and
 *     resolved using `defaultWoodType`. Set `guessWoodDefaults` to false to
 *     disable this behavior. `maxIngredientsPerCraftedItem` can limit the
 *     number of uncraft recipes generated for each crafted item.
 *
 * Register in config.json (regolith.filterDefinitions):
 *
 *   "generate_uncraft_table": {
 *     "runWith": "nodejs",
 *     "script": "./filters/generate_uncraft_table.cjs"
 *   }
 *
 * Profile settings (all optional; values shown are the defaults):
 *
 *   {
 *     "filter": "generate_uncraft_table",
 *     "settings": {
 *       "returnRate": 0.5,
 *       "minPerIngredient": 0,
 *       "maxPerIngredient": 64,
 *       "recipesDir": "./BP/recipes",
 *       "outputDir": "./BP/recipes/uncraft",
 *       "tags": ["crafting_table"],
 *       "allowedTags": ["crafting_table"],
 *       "formatVersion": "1.12",
 *       "verbose": false,
 *       "excludeDirs": [],
 *       "excludeItems": ["minecraft:oak_planks"],
 *       "defaultWoodType": "oak",
 *       "guessWoodDefaults": true,
 *       "maxIngredientsPerCraftedItem": null,
 *       "cleanupStrayFiles": true,
 *       "maxDepth": null,
 *       "unlockOn": "result",
 *       "tagDefaults": {
 *         "planks": "minecraft:oak_planks",
 *         "wood": "minecraft:oak_wood",
 *         "logs": "minecraft:oak_log",
 *         "stripped_logs": "minecraft:stripped_oak_log"
 *       }
 *     }
 *   }
 *
 * Settings:
 * - recipesDir: one path or an array of paths to scan recursively.
 * - excludeDirs: additional directories to exclude; paths are relative to
 *   the filter's cwd. `outputDir` is always excluded automatically.
 * - excludeItems: crafted item IDs that must never receive an uncraft recipe.
 * - tagDefaults: exact, case-insensitive tag-to-item mappings, with or
 *   without the `minecraft:` namespace. These take precedence over inference.
 * - guessWoodDefaults: infer wood items from tag names when no exact mapping
 *   exists, using `defaultWoodType`. Set to false to disable inference.
 * - defaultWoodType: the preferred wood variant when multiple recipes
 *   produce the same item. The filter prefers a resolved ingredient matching
 *   this token, then falls back to the filename or identifier.
 * - maxIngredientsPerCraftedItem: optional positive integer limiting the
 *   number of distinct ingredients used to generate recipes for one item.
 *   Higher ingredient quantities are prioritized. This can reduce duplicate
 *   crafting-table recipe warnings; those warnings are expected otherwise.
 * - cleanupStrayFiles: remove obsolete `.uncraft.` files outside `outputDir`
 *   when true. Set to false to keep them and handle cleanup manually.
 * - maxDepth: maximum directory depth below each `recipesDir` root. The
 *   default is unlimited; files directly in each root are always scanned.
 * - unlockOn: fallback unlock behavior when the original recipe has none:
 *   `"result"` unlocks the returned item, `"crafted"` unlocks the item being
 *   uncrafted, and `"none"` adds no unlock requirement.
 * - allowedTags: allowed tags on original recipes. Change this only to enable
 *   uncrafting at stations other than crafting tables.
 * - tags: tags written to generated recipes. By default, recipes use the
 *   `crafting_table` tag.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

// On Windows, a file or directory marked read-only by a previous run using
// export.readOnly (or copied that way from build/) can make writeFile fail
// with EPERM even when its contents should be replaceable. Try to unlock the
// file with chmod and write it again before giving up.
async function safeWriteFile(filePath, content) {
  try {
    await fsp.writeFile(filePath, content, 'utf-8');
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      try {
        await fsp.chmod(filePath, 0o666);
      } catch {
        // The file may not exist yet (the read-only path may have been its parent); ignore.
      }
      await fsp.writeFile(filePath, content, 'utf-8'); // Let a second failure propagate.
    } else {
      throw e;
    }
  }
}

// Accept a single string or an array of directories in recipesDir and always
// return a non-empty array (see item 13 at the top of this file).
function normalizeRecipesDirsSetting(value) {
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => String(v).trim()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return ['./BP/recipes'];
}

function loadSettings() {
  let raw = {};
  const arg = process.argv[2];
  if (arg) {
    try {
      raw = JSON.parse(arg);
    } catch {
      console.warn(
        '[generate_uncraft_table] invalid settings in process.argv[2], using defaults',
      );
    }
  }
  return {
    returnRate: raw.returnRate ?? 0.5,
    minPerIngredient: raw.minPerIngredient ?? 0,
    maxPerIngredient: raw.maxPerIngredient ?? 64,
    // Always an array with at least one directory; see normalizeRecipesDirsSetting/item 13.
    recipesDir: normalizeRecipesDirsSetting(raw.recipesDir),
    outputDir: raw.outputDir ?? './BP/recipes/uncraft',
    tags: raw.tags ?? ['crafting_table'],
    allowedTags: raw.allowedTags ?? ['crafting_table'],
    formatVersion: raw.formatVersion ?? '1.12',
    // Enabled by default so the scan and each generated uncraft recipe can be audited.
    verbose: raw.verbose ?? true,
    // Additional directories (besides outputDir, which is always excluded)
    // to skip during recipe scans; paths are relative to the filter's cwd.
    excludeDirs: Array.isArray(raw.excludeDirs) ? raw.excludeDirs : [],
    // Items that must NEVER receive an uncraft recipe, even if the original
    // recipe is eligible (e.g. "minecraft:oak_planks").
    excludeItems: Array.isArray(raw.excludeItems) ? raw.excludeItems : [],
    // Resolve a tag ingredient (e.g. {"tag":"planks"}) to this concrete
    // item instead of skipping it because there is no single item to return.
    // Takes precedence over generic recognition (guessWoodDefaults).
    tagDefaults:
      raw.tagDefaults && typeof raw.tagDefaults === 'object'
        ? raw.tagDefaults
        : {
            planks: 'minecraft:oak_planks',
            wood: 'minecraft:oak_wood',
            logs: 'minecraft:oak_log',
            stripped_logs: 'minecraft:stripped_oak_log',
          },
    // When the same crafted item has multiple recipes (one per wood type),
    // the variant whose resolved ingredient (or, failing that, filename or
    // identifier) contains this token becomes canonical; other wood variants
    // for that item are skipped. Also used as the wood type when
    // guessWoodDefaults recognizes a generic tag.
    defaultWoodType:
      typeof raw.defaultWoodType === 'string' ? raw.defaultWoodType : 'oak',
    // If true (default), wood tags without an exact tagDefaults match are
    // recognized by NAME (planks/log/wood/fence/door/boat/etc.) and resolved
    // to defaultWoodType instead of being skipped.
    guessWoodDefaults: raw.guessWoodDefaults ?? true,
    // Limit how many distinct ingredients for a crafted item become uncraft
    // recipes, prioritizing larger quantities. null/omitted = unlimited
    // (previous behavior: generate one file per ingredient).
    maxIngredientsPerCraftedItem:
      Number.isInteger(raw.maxIngredientsPerCraftedItem) &&
      raw.maxIngredientsPerCraftedItem > 0
        ? raw.maxIngredientsPerCraftedItem
        : Infinity,
    // Kept for compatibility with older profiles. The current scan does not
    // remove or skip files by name; only the `uncraft` directory is excluded.
    cleanupStrayFiles: raw.cleanupStrayFiles ?? false,
    // How many subdirectory levels to descend from each recipesDir root.
    // The scan is unlimited by default and visits ALL recipesDir subdirectories.
    // Depth is limited only when maxDepth is explicitly set.
    maxDepth:
      Number.isInteger(raw.maxDepth) && raw.maxDepth >= 0
        ? raw.maxDepth
        : Infinity,
    // When the original recipe has no "unlock", choose which item to
    // reference in the generated unlock: "result" (the returned item;
    // default), "crafted" (the item being uncrafted), or "none" (no unlock).
    unlockOn:
      raw.unlockOn === 'crafted' || raw.unlockOn === 'none'
        ? raw.unlockOn
        : 'result',
  };
}

// outputDir is always excluded from the scan; otherwise the filter would
// reprocess uncraft recipes generated in the previous run. excludeDirs can
// add other directories to this list.
function buildExcludedDirs(settings) {
  const dirs = [settings.outputDir, ...settings.excludeDirs];
  // Use an array instead of a Set so isPathInside() can match entire
  // subdirectories, not just exact paths.
  return dirs.map((d) => path.resolve(d));
}

function normalizeItemId(itemId) {
  if (typeof itemId !== 'string') return null;
  const value = itemId.trim();
  if (!value) return null;
  return value.includes(':') ? value : `minecraft:${value}`;
}

// Patterns for identifying which wood item a generic wood tag represents
// based only on its NAME (e.g. "planks", "any_fence", "stripped_logs_custom").
// This builds the concrete item using the default wood type
// (settings.defaultWoodType) without listing every tag in tagDefaults.
// Order matters: specific patterns come first (e.g. "stripped log" must
// match before the generic "log" pattern).
const WOOD_TAG_PATTERNS = [
  { test: /stripped.*log|log.*stripped/, build: (w) => `stripped_${w}_log` },
  {
    test: /stripped.*(hyphae|wood)|(hyphae|wood).*stripped/,
    build: (w) => `stripped_${w}_wood`,
  },
  { test: /log/, build: (w) => `${w}_log` },
  { test: /hyphae|wood/, build: (w) => `${w}_wood` },
  { test: /planks?/, build: (w) => `${w}_planks` },
  { test: /pressure_plate/, build: (w) => `${w}_pressure_plate` },
  { test: /trapdoor/, build: (w) => `${w}_trapdoor` },
  { test: /button/, build: (w) => `${w}_button` },
  { test: /fence_gate/, build: (w) => `${w}_fence_gate` },
  { test: /fence/, build: (w) => `${w}_fence` },
  { test: /slab/, build: (w) => `${w}_slab` },
  { test: /stairs/, build: (w) => `${w}_stairs` },
  { test: /door/, build: (w) => `${w}_door` },
  { test: /sign/, build: (w) => `${w}_sign` },
  { test: /boat/, build: (w) => `${w}_boat` },
];

// Try to recognize a wood tag without an exact tagDefaults entry by its
// name, then build the concrete item using the default wood type. Return null
// if no pattern matches (the tag will remain skipped, as before).
function resolveGenericWoodTag(tagName, settings) {
  const normalized = String(tagName)
    .toLowerCase()
    .replace(/^minecraft:/, '');
  for (const { test, build } of WOOD_TAG_PATTERNS) {
    if (test.test(normalized)) {
      return normalizeItemId(build(settings.defaultWoodType));
    }
  }
  return null;
}

// Return { item, count } for a concrete ingredient, { tag, count } for a tag
// ingredient unresolved by tagDefaults or generic wood recognition, or null
// if the reference cannot be parsed.
function normalizeRef(ref, settings, stats) {
  if (!ref) return null;
  if (typeof ref === 'string') {
    const item = normalizeItemId(ref);
    return item ? { item, count: 1 } : null;
  }
  if (ref.tag) {
    const tagName = String(ref.tag);
    const normalizedTagName = tagName.toLowerCase().replace(/^minecraft:/, '');

    // 1) Exact match configured in settings.tagDefaults (accepts the tag
    //    with or without the "minecraft:" namespace, case-insensitive).
    let fallback = null;
    if (settings?.tagDefaults) {
      const matchedKey = Object.keys(settings.tagDefaults).find(
        (key) =>
          key.toLowerCase().replace(/^minecraft:/, '') === normalizedTagName,
      );
      if (matchedKey) fallback = settings.tagDefaults[matchedKey];
    }

    // 2) Without an exact match, identify the wood item represented by the
    //    tag NAME and resolve it to the default wood type. This prevents a
    //    recipe with an unspecified wood type (a generic tag without an
    //    exact tagDefaults entry) from being ignored; it uses oak or the
    //    value configured in defaultWoodType.
    if (!fallback && settings && settings.guessWoodDefaults !== false) {
      const guessed = resolveGenericWoodTag(tagName, settings);
      if (guessed) {
        fallback = guessed;
        if (stats) stats.tagResolvedByWoodPattern++;
      }
    }

    if (fallback) {
      const item = normalizeItemId(fallback);
      if (item) return { item, count: ref.count ?? 1 };
    }
    return { tag: tagName, count: ref.count ?? 1 };
  }
  if (!ref.item) return null;
  const item = normalizeItemId(ref.item);
  if (!item) return null;
  return { item, count: ref.count ?? 1 };
}

function firstResult(result) {
  const r = Array.isArray(result) ? result[0] : result;
  return normalizeRef(r, null, null);
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

// Allowlist: an original recipe is eligible only if ALL of its tags are in
// settings.allowedTags. This ensures that only crafting table recipes are
// converted to uncraft recipes.
function isEligibleForUncraft(recipeBlock, settings) {
  if (!recipeBlock) return false;
  const tags = normalizeTags(recipeBlock.tags);
  if (tags.length === 0) return false;
  if (tags.includes('deprecated')) return false;
  return tags.every((tag) => settings.allowedTags.includes(tag));
}

function countIngredients(ingredients, stats, settings) {
  const counts = new Map();
  for (const ref of ingredients || []) {
    const normalized = normalizeRef(ref, settings, stats);
    if (!normalized) continue;
    if (normalized.tag) {
      if (stats) stats.tagIngredientsSkipped++;
      continue;
    }
    counts.set(
      normalized.item,
      (counts.get(normalized.item) ?? 0) + normalized.count,
    );
  }
  return counts;
}

function invertShaped(recipe) {
  const flat = [];
  for (const row of recipe.pattern) {
    for (const symbol of row) {
      if (symbol === ' ' || symbol === '') continue;
      const ref = recipe.key[symbol];
      if (ref) flat.push(ref);
    }
  }
  return flat;
}

// Read the original recipe (shaped OR shapeless) and return the result item
// plus consolidated ingredient counts. Return null if the recipe is
// ineligible (unsupported type, not exclusively crafting_table, etc.),
// incrementing the corresponding stats counter for logging.
function extractIngredientsAndResult(raw, settings, stats) {
  let block;
  let shapeType;

  if (raw['minecraft:recipe_shaped']) {
    block = raw['minecraft:recipe_shaped'];
    shapeType = 'shaped';
  } else if (raw['minecraft:recipe_shapeless']) {
    block = raw['minecraft:recipe_shapeless'];
    shapeType = 'shapeless';
  } else {
    stats.otherRecipeType++;
    return null;
  }

  if (!block || !block.result) return null;
  if (shapeType === 'shaped' && (!block.pattern || !block.key)) return null;
  if (shapeType === 'shapeless' && !Array.isArray(block.ingredients))
    return null;

  if (!isEligibleForUncraft(block, settings)) {
    stats.notCraftingTable++;
    return null;
  }

  const resultItem = firstResult(block.result);
  if (!resultItem || !resultItem.item) return null;

  const flatIngredients =
    shapeType === 'shaped' ? invertShaped(block) : block.ingredients;

  const counts = countIngredients(flatIngredients, stats, settings);
  if (counts.size === 0) return null;

  return {
    resultItem,
    counts,
    tags: normalizeTags(block.tags),
    identifier:
      block.description && typeof block.description.identifier === 'string'
        ? block.description.identifier
        : null,
    // Original recipe format_version (e.g. "1.20.10"), inherited by the
    // generated file instead of hard-coding an outdated value.
    formatVersion:
      typeof raw.format_version === 'string' ? raw.format_version : null,
    // Original recipe "unlock" block (e.g. {"context":"PlayerInWater"} on
    // boats), copied to the uncraft recipe instead of being discarded.
    unlock:
      block.unlock && typeof block.unlock === 'object' ? block.unlock : null,
  };
}

// Return true if a token delimited by non-alphanumeric characters matches
// `token` exactly (case-insensitive). This avoids false positives such as
// matching "oak" inside another word.
function hasToken(text, token) {
  if (!text) return false;
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(token.toLowerCase());
}

// "minecraft:stick" -> { namespace: "minecraft", name: "stick" }
function splitNamespace(itemId) {
  const safeItem = normalizeItemId(itemId) ?? 'minecraft:unknown';
  const idx = safeItem.indexOf(':');
  if (idx === -1) return { namespace: 'minecraft', name: safeItem };
  return { namespace: safeItem.slice(0, idx), name: safeItem.slice(idx + 1) };
}

// Keep only [a-z0-9_] for use in identifiers and filenames.
function sanitize(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Use the original recipe identifier as the base of the output identifier
// when available, avoiding collisions between recipes that produce the
// same item.
function buildUncraftIdentifier(
  craftedItem,
  ingredientItem,
  originalIdentifier,
) {
  const { namespace, name: craftedName } = splitNamespace(craftedItem);
  const { name: ingredientName } = splitNamespace(ingredientItem);

  let base;
  if (originalIdentifier) {
    const idx = originalIdentifier.indexOf(':');
    base = sanitize(
      idx === -1 ? originalIdentifier : originalIdentifier.slice(idx + 1),
    );
  } else {
    base = sanitize(craftedName);
  }

  return `${namespace}:uncraft_${base}_to_${sanitize(ingredientName)}`;
}

// A recipe_shaped with one pattern symbol: consumes exactly one crafted
// item (in "key") and returns the reduced ingredient quantity (in "result").
// Use recipe_shaped instead of shapeless because it matches the rest of the
// pack and supports "unlock" in the format expected by the game.
function buildUncraftRecipe(
  craftedItem,
  ingredientItem,
  count,
  settings,
  originalTags,
  originalIdentifier,
  originalFormatVersion,
  originalUnlock,
) {
  const safeCraftedItem = normalizeItemId(craftedItem) ?? craftedItem;
  const safeIngredientItem = normalizeItemId(ingredientItem) ?? ingredientItem;
  const identifier = buildUncraftIdentifier(
    safeCraftedItem,
    safeIngredientItem,
    originalIdentifier,
  );
  const tags =
    originalTags && originalTags.length > 0 ? originalTags : settings.tags;
  const formatVersion = originalFormatVersion || settings.formatVersion;

  const block = {
    description: {
      identifier,
    },
    tags,
    pattern: ['#'],
    key: {
      '#': { item: safeCraftedItem },
    },
  };

  if (originalUnlock) {
    block.unlock = originalUnlock;
  } else if (settings.unlockOn !== 'none') {
    const unlockItem =
      settings.unlockOn === 'crafted' ? safeCraftedItem : safeIngredientItem;
    block.unlock = { item: unlockItem };
  }

  block.result = {
    item: safeIngredientItem,
    count,
  };

  return {
    format_version: formatVersion,
    'minecraft:recipe_shaped': block,
  };
}

// A candidate "has" a wood token (e.g. "oak") if any of its resolved
// ingredients (after tagDefaults/guessWoodDefaults) contains it. This is
// reliable because it reflects what the player actually gets back. The
// filename/identifier is used only as a secondary tiebreaker.
function candidateHasWoodToken(candidate, token) {
  for (const item of candidate.data.counts.keys()) {
    if (hasToken(item, token)) return true;
  }
  return (
    hasToken(path.basename(candidate.file, '.json'), token) ||
    hasToken(candidate.data.identifier, token)
  );
}

// Among recipes that produce the SAME item (usually one per wood type),
// choose which one will be used for uncraft generation. Prefer the recipe
// returning settings.defaultWoodType; if none match, use the first one.
function pickCanonicalCandidate(candidates, settings) {
  if (candidates.length === 1) return candidates;
  const preferred = candidates.find((c) =>
    candidateHasWoodToken(c, settings.defaultWoodType),
  );
  return [preferred ?? candidates[0]];
}

// Calculate the common base directory of the configured roots.
// This matters when `recipesDir` contains multiple directories, for example:
//   ["./BP/recipes/blocks", "./BP/recipes/items"]
// In this case, the output becomes:
//   ./BP/recipes/uncraft/blocks/...
//   ./BP/recipes/uncraft/items/...
// instead of placing files from both roots directly inside `uncraft`.
function findCommonBaseDir(roots) {
  const resolvedRoots = roots.map((root) => path.resolve(root));

  if (resolvedRoots.length === 0) {
    return path.resolve('.');
  }

  const parsed = resolvedRoots.map((root) => {
    const normalized = path.normalize(root);
    const parsedRoot = path.parse(normalized).root;
    const rest = normalized
      .slice(parsedRoot.length)
      .split(path.sep)
      .filter(Boolean);
    return { root: parsedRoot, parts: rest };
  });

  if (
    !parsed.every(
      (item) => item.root.toLowerCase() === parsed[0].root.toLowerCase(),
    )
  ) {
    return resolvedRoots[0];
  }

  const commonParts = [];
  const firstParts = parsed[0].parts;

  for (let i = 0; i < firstParts.length; i++) {
    const part = firstParts[i];
    if (parsed.every((item) => item.parts[i] === part)) {
      commonParts.push(part);
    } else {
      break;
    }
  }

  return path.join(parsed[0].root, ...commonParts);
}

function isPathInside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

// The scan skips only directories named `uncraft`, including the output
// directory and any subdirectory with that name.
function isUncraftDirectory(target) {
  return path.basename(path.resolve(target)).toLowerCase() === 'uncraft';
}

// `file` is the original recipe. Output always stays inside `outputDir`.
// The relative path is calculated from the tree's structural base, not from
// each individual root. This prevents different subdirectories from being
// flattened into `uncraft`.
function resolveOutputPath(entry, settings) {
  const outputRoot = path.resolve(settings.outputDir);
  const relativeDir = entry.outputRelativeDir || '';
  const targetDir = path.resolve(outputRoot, relativeDir || '.');

  // Absolute rule: NO file from this filter may be written outside outputDir.
  // Stop generation and report the path instead of allowing path.join to
  // escape because of a ".." segment.
  if (!isPathInside(outputRoot, targetDir)) {
    throw new Error(
      `unsafe output path: ${targetDir} is outside ${outputRoot} (source: ${entry.file})`,
    );
  }

  const outPath = path.join(targetDir, path.basename(entry.file));
  if (!isPathInside(outputRoot, outPath)) {
    throw new Error(
      `unsafe output file: ${outPath} is outside ${outputRoot} (source: ${entry.file})`,
    );
  }

  return outPath;
}

// Scan ONE root directory for original recipes (.json) asynchronously. Each
// directory is read with fs.promises.readdir (withFileTypes), and sibling
// subdirectories are scanned IN PARALLEL with Promise.all.
//
// - dirent.isDirectory() does not follow symlinks. For symbolic links, use
//   fs.stat (which follows the link) so linked directories are not missed.
// - A read error in ANY directory (for example, a permissions error) does not
//   abort the entire scan; it logs a warning and skips only that directory.
//
// Also remove orphaned files from an older version of this filter: any file
// with ".uncraft." in its name found HERE (outside outputDir, already in
// excludedDirs) is assumed to be obsolete. If settings.cleanupStrayFiles is
// enabled (default), those files are deleted.
//
// `depth` counts how many directory levels have been traversed from the root
// (depth 0 = the root itself). Files in every visited directory are read;
// only RECURSION into another subdirectory stops at `settings.maxDepth`.
/**
 * INDEX A COMPLETE RECIPE TREE.
 *
 * Scan rules:
 *   - the effective root is the `recipes` directory reached from `recipesDir`;
 *   - all subdirectories are visited, with no depth limit;
 *   - the ONLY automatically skipped structural directory is `uncraft`;
 *   - `excludeDirs` is also honored;
 *   - no JSON files are skipped based on their filenames.
 *
 * This function returns only when the directory queue is empty. It INDEXES
 * every directory before main starts reading JSON files, preventing
 * compilation from starting while undiscovered directories remain.
 */
async function indexRecipeTree(
  rootDir,
  excludedDirs,
  settings,
  stats,
  globalVisited = null,
  outputStructureBase = null,
) {
  const root = path.resolve(rootDir);
  const structureBase = outputStructureBase
    ? path.resolve(outputStructureBase)
    : root;
  const indexedDirs = [];
  const fileEntries = [];
  const queue = [root];
  const visitedDirs = new Set();

  while (queue.length > 0) {
    const currentDir = queue.shift();
    const absoluteDir = path.resolve(currentDir);

    // Only `uncraft` and directories explicitly excluded in the settings can
    // block an entry in the tree.
    if (isUncraftDirectory(absoluteDir)) {
      if (settings.verbose) {
        console.log(
          `[generate_uncraft_table] [INDEX] skipping uncraft: ${absoluteDir}`,
        );
      }
      continue;
    }

    if (excludedDirs.some((excluded) => isPathInside(excluded, absoluteDir))) {
      if (settings.verbose) {
        console.log(
          `[generate_uncraft_table] [INDEX] skipped by excludeDirs: ${absoluteDir}`,
        );
      }
      continue;
    }

    // Use realpath to avoid loops caused by symlinks.
    let visitKey = absoluteDir;
    try {
      visitKey = await fsp.realpath(absoluteDir);
    } catch {
      // The regular path still works if realpath fails.
    }
    visitKey = path.normalize(visitKey).toLowerCase();

    if (
      visitedDirs.has(visitKey) ||
      (globalVisited && globalVisited.has(visitKey))
    ) {
      if (settings.verbose) {
        console.log(
          `[generate_uncraft_table] [INDEX] directory already indexed: ${absoluteDir}`,
        );
      }
      continue;
    }
    visitedDirs.add(visitKey);
    if (globalVisited) globalVisited.add(visitKey);

    let dirents;
    try {
      dirents = await fsp.readdir(absoluteDir, { withFileTypes: true });
    } catch (e) {
      stats.directoryReadErrors++;
      console.warn(
        `[generate_uncraft_table] [INDEX] could not read directory: ${absoluteDir} | ${e.message}`,
      );
      continue;
    }

    dirents.sort((a, b) => a.name.localeCompare(b.name));
    indexedDirs.push(absoluteDir);

    console.log(
      `[generate_uncraft_table] [INDEX] directory ${indexedDirs.length}: ${absoluteDir} | ${dirents.length} entr(y/ies)`,
    );

    for (const dirent of dirents) {
      const entryName = dirent.name;
      const full = path.resolve(absoluteDir, entryName);

      if (isUncraftDirectory(full)) {
        if (settings.verbose) {
          console.log(
            `[generate_uncraft_table] [INDEX]   -> skipped uncraft directory: ${full}`,
          );
        }
        continue;
      }

      if (excludedDirs.some((excluded) => isPathInside(excluded, full))) {
        if (settings.verbose) {
          console.log(
            `[generate_uncraft_table] [INDEX]   -> excluded by settings: ${full}`,
          );
        }
        continue;
      }

      let isDir = dirent.isDirectory();
      if (dirent.isSymbolicLink()) {
        try {
          const resolved = await fsp.stat(full);
          isDir = resolved.isDirectory();
        } catch {
          stats.brokenSymlinksSkipped++;
          if (settings.verbose) {
            console.warn(
              `[generate_uncraft_table] [INDEX]   -> broken symlink: ${full}`,
            );
          }
          continue;
        }
      }

      if (isDir) {
        queue.push(full);
        console.log(
          `[generate_uncraft_table] [INDEX]   -> subdirectory QUEUED (${queue.length} pending): ${full}`,
        );
        continue;
      }

      // No filename filtering: every JSON outside `uncraft` is indexed.
      if (path.extname(entryName).toLowerCase() !== '.json') continue;

      const foundDir = absoluteDir;
      const relativeDir = path.relative(root, foundDir);
      // Calculate this from the COMMON base of all configured roots
      // (structureBase), not from the individual root. With an array-valued
      // recipesDir, using each root would drop its identifying prefix (such
      // as "blocks/" or "items/") and could cause output collisions.
      const outputRelativeDir = path.relative(structureBase, foundDir);
      const entry = {
        file: full,
        root,
        foundDir,
        relativeDir,
        outputRelativeDir,
      };
      fileEntries.push(entry);

      console.log(
        `[generate_uncraft_table] [INDEXED RECIPE] #${fileEntries.length} | ${full}`,
      );
      console.log(
        `[generate_uncraft_table] [INDEXED RECIPE]     source: ${foundDir}`,
      );
      console.log(
        `[generate_uncraft_table] [INDEXED RECIPE]     output: ${path.resolve(settings.outputDir, outputRelativeDir || '.')}`,
      );
    }

    console.log(
      `[generate_uncraft_table] [INDEX] complete: ${absoluteDir} | queued=${queue.length} | recipes accumulated=${fileEntries.length}`,
    );
  }

  return { indexedDirs, fileEntries, visitedDirs };
}

async function main() {
  const settings = loadSettings();
  const excludedItems = new Set(
    settings.excludeItems.map((item) => normalizeItemId(item)).filter(Boolean),
  );
  const usedIdentifiers = new Set();
  const stats = {
    processed: 0,
    written: 0,
    skippedNoViableReturn: 0,
    notCraftingTable: 0,
    otherRecipeType: 0,
    tagIngredientsSkipped: 0,
    tagResolvedByWoodPattern: 0,
    selfReferenceSkipped: 0,
    excludedByItemList: 0,
    collapsedWoodVariants: 0,
    parseErrors: 0,
    removedStrayFiles: 0,
    strayFilesFoundButKept: 0,
    maxDepthExceeded: 0,
    brokenSymlinksSkipped: 0,
    directoryReadErrors: 0,
  };

  // `recipesDir` is the SOURCE OF TRUTH for the scan.
  // Do NOT search for a directory named `recipes` or walk up to parent
  // directories. Each configured path is an actual scan root.
  //
  // Exemplo:
  //   recipesDir = ./BP/recipes
  //
  // The scan therefore visits EXACTLY:
  //   ./BP/recipes/**
  // including all directories, levels, and JSON files except `uncraft`.
  //
  // If `recipesDir` is an array, ALL configured roots are scanned.
  const roots = [
    ...new Set(settings.recipesDir.map((root) => path.resolve(root))),
  ].filter((root) => !isUncraftDirectory(root));

  if (roots.length === 0) {
    throw new Error(
      '[generate_uncraft_table] recipesDir contains no valid directory to scan.',
    );
  }

  const outputDirAbsolute = path.resolve(settings.outputDir);
  const excludedDirs = buildExcludedDirs(settings);

  // Ensure the output base directory exists even if no recipes are generated
  // during this run. Subdirectories are created as needed.
  await fsp.mkdir(outputDirAbsolute, { recursive: true });

  // ================================================================
  // PHASE 1 — COMPLETE INDEXING OF THE `recipes` TREE
  // ================================================================
  // `recipesDir` is the reference CONFIGURATION: it determines the starting
  // directory. Indexing then traverses the entire recipe tree rather than
  // stopping at the configured subdirectory. Nothing is parsed or compiled
  // until the directory queue is empty.
  const outputStructureBase =
    roots.length === 1 ? roots[0] : findCommonBaseDir(roots);

  console.log(
    `[generate_uncraft_table] PHASE 1/3: STARTING FULL INDEX | ${roots.length} recipe root(s)`,
  );
  for (const root of roots) {
    console.log(`[generate_uncraft_table] [ROOT] ${root}`);
  }
  console.log(
    `[generate_uncraft_table] [OUTPUT] ${outputDirAbsolute} | the uncraft directory will NOT be indexed`,
  );

  const allIndexedDirs = [];
  const fileEntries = [];
  const globalVisited = new Set();

  // Fully index each configured root BEFORE starting the next phase. The
  // scanner returns only after that root's directory queue is empty. Global
  // deduplication prevents scanning the same tree twice when roots overlap.
  for (const root of roots) {
    const result = await indexRecipeTree(
      root,
      excludedDirs,
      settings,
      stats,
      globalVisited,
      outputStructureBase,
    );

    allIndexedDirs.push(...result.indexedDirs);
    fileEntries.push(...result.fileEntries);
  }

  // A recipe can appear in overlapping configured roots. Deduplicate by
  // absolute path before reading or compiling.
  const uniqueFiles = new Map();
  for (const entry of fileEntries) {
    uniqueFiles.set(path.resolve(entry.file).toLowerCase(), entry);
  }
  fileEntries.length = 0;
  fileEntries.push(...uniqueFiles.values());

  fileEntries.sort((a, b) => a.file.localeCompare(b.file));

  console.log(
    `[generate_uncraft_table] PHASE 1/3 COMPLETE: ${allIndexedDirs.length} director(y/ies) indexed | ${fileEntries.length} JSON recipe(s) found | ${globalVisited.size} unique director(y/ies) visited`,
  );
  console.log(
    `[generate_uncraft_table] [GUARANTEE] Compilation starts only after the indexing queue is empty.`,
  );

  for (const entry of fileEntries) {
    console.log(
      `[generate_uncraft_table] [FINAL INDEX] ${entry.file} | directory=${entry.foundDir} | relative=${entry.relativeDir || '(root)'}`,
    );
  }

  // ================================================================
  // PHASE 2 — COMPLETE READ/PARSE
  // ================================================================
  // Nothing is written in this phase either. All recipes must be read before
  // grouping and canonicalization can begin.
  if (settings.verbose) {
    console.log(
      `[generate_uncraft_table] PHASE 2/3: reading ${fileEntries.length} recipe(s) before compilation.`,
    );
  }

  const parsedFiles = await Promise.all(
    fileEntries.map(async (entry) => {
      const { file, root, foundDir, relativeDir, outputRelativeDir } = entry;
      try {
        const raw = JSON.parse(await fsp.readFile(file, 'utf-8'));
        if (settings.verbose) {
          console.log(
            `[generate_uncraft_table] [READ] ${file} | source: ${foundDir}`,
          );
        }
        return { file, root, foundDir, relativeDir, outputRelativeDir, raw };
      } catch (e) {
        stats.parseErrors++;
        console.warn(
          `[generate_uncraft_table] Error reading/parsing ${file}: ${e.message}`,
        );
        return null;
      }
    }),
  );

  // The complete set of recipes is now available.
  const groupsByResultItem = new Map();

  for (const parsed of parsedFiles) {
    if (!parsed) continue;

    const { file, root, foundDir, relativeDir, outputRelativeDir, raw } =
      parsed;
    const data = extractIngredientsAndResult(raw, settings, stats);
    if (!data) continue;

    if (excludedItems.has(normalizeItemId(data.resultItem.item))) {
      stats.excludedByItemList++;
      continue;
    }

    const key = data.resultItem.item;

    if (!groupsByResultItem.has(key)) {
      groupsByResultItem.set(key, []);
    }

    groupsByResultItem.get(key).push({
      file,
      root,
      foundDir,
      relativeDir,
      outputRelativeDir,
      data,
    });
  }

  if (settings.verbose) {
    console.log(
      `[generate_uncraft_table] PHASE 2/3 complete: read ${parsedFiles.filter(Boolean).length} file(s), grouped ${groupsByResultItem.size} result item(s).`,
    );
  }

  // ================================================================
  // PHASE 3 — COMPILATION
  // ================================================================
  if (settings.verbose) {
    console.log(
      `[generate_uncraft_table] PHASE 3/3: compiling all discovered recipes.`,
    );
  }

  // For each result item, collapse multiple wood variants into one (preferring
  // defaultWoodType) and build each uncraft file's content. This part is
  // synchronous and pure; it only determines what to write.
  const writes = []; // { outPath, content }

  for (const candidates of groupsByResultItem.values()) {
    const [chosen] = pickCanonicalCandidate(candidates, settings);
    stats.collapsedWoodVariants += candidates.length - 1;

    const { file, root, foundDir, relativeDir, outputRelativeDir, data } =
      chosen;
    stats.processed++;
    const groupResult = { attempted: false };

    // Optionally limit how many distinct ingredients for this item become
    // uncraft recipes, prioritizing higher quantities (see
    // maxIngredientsPerCraftedItem in the settings).
    let entries = Array.from(data.counts.entries());
    if (Number.isFinite(settings.maxIngredientsPerCraftedItem)) {
      entries = entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, settings.maxIngredientsPerCraftedItem);
    }

    for (const [ingredientItem, originalCount] of entries) {
      if (!ingredientItem) continue;
      if (ingredientItem === data.resultItem.item) {
        // The recipe uses the crafted item as one of its own ingredients
        // (self-reference); generating an uncraft recipe would not make sense.
        stats.selfReferenceSkipped++;
        continue;
      }

      const rawAmount =
        (originalCount * settings.returnRate) / (data.resultItem.count || 1);
      const amount = Math.min(
        settings.maxPerIngredient,
        Math.max(settings.minPerIngredient, Math.floor(rawAmount)),
      );

      if (amount <= 0) continue;
      groupResult.attempted = true;

      const recipe = buildUncraftRecipe(
        data.resultItem.item,
        ingredientItem,
        amount,
        settings,
        data.tags,
        data.identifier,
        data.formatVersion,
        data.unlock,
      );

      // Never produce a duplicate identifier, even if the original recipe
      // already has one (a bug elsewhere in the pack); append a numeric
      // suffix in that case.
      const block = recipe['minecraft:recipe_shaped'];
      let uniqueIdentifier = block.description.identifier;
      let suffix = 2;
      while (usedIdentifiers.has(uniqueIdentifier)) {
        uniqueIdentifier = `${block.description.identifier}_${suffix}`;
        suffix++;
      }
      if (uniqueIdentifier !== block.description.identifier) {
        console.warn(
          `[generate_uncraft_table] prevented duplicate identifier: ${block.description.identifier} -> ${uniqueIdentifier} (the original recipe may have a duplicate identifier in ${file})`,
        );
      }
      block.description.identifier = uniqueIdentifier;
      usedIdentifiers.add(uniqueIdentifier);

      const { name: ingredientName } = splitNamespace(ingredientItem);
      const outputBase = resolveOutputPath(
        { file, root, foundDir, relativeDir, outputRelativeDir },
        settings,
      );
      const outPath = outputBase.replace(
        /\.json$/,
        `.${sanitize(ingredientName)}.json`,
      );

      const generatedContent = JSON.stringify(recipe, null, 2) + '\n';
      writes.push({
        file,
        outPath,
        content: generatedContent,
        craftedItem: data.resultItem.item,
        craftedCount: data.resultItem.count || 1,
        ingredientItem,
        ingredientOriginalCount: originalCount,
        returnCount: amount,
        originalIdentifier: data.identifier || '(sem identifier)',
        generatedIdentifier: uniqueIdentifier,
        sourceDir: foundDir,
        relativeDir: outputRelativeDir || '',
      });

      // Log details for the recipe that WILL be created before writing files.
      console.log(`[generate_uncraft_table] [UNCRAFT] CREATING: ${outPath}`);
      console.log(`[generate_uncraft_table] [UNCRAFT]   source:      ${file}`);
      console.log(
        `[generate_uncraft_table] [UNCRAFT]   source dir:  ${foundDir}`,
      );
      console.log(
        `[generate_uncraft_table] [UNCRAFT]   output dir:  ${path.dirname(outPath)}`,
      );
      console.log(
        `[generate_uncraft_table] [UNCRAFT]   input:        ${data.resultItem.item} x${data.resultItem.count || 1}`,
      );
      console.log(
        `[generate_uncraft_table] [UNCRAFT]   ingredient:  ${ingredientItem} x${originalCount} -> return x${amount}`,
      );
      console.log(
        `[generate_uncraft_table] [UNCRAFT]   identifier:   ${uniqueIdentifier}`,
      );
      if (settings.verbose) {
        console.log(`[generate_uncraft_table] [UNCRAFT]   JSON:`);
        console.log(generatedContent.trimEnd());
      }
    }

    // If no ingredient has an amount greater than zero (returnRate or
    // minPerIngredient reduced everything to zero, or all ingredients were
    // self-references), this is known without waiting for disk writes.
    if (!groupResult.attempted) stats.skippedNoViableReturn++;
  }

  console.log(
    `[generate_uncraft_table] PHASE 3/3 complete: ${writes.length} uncraft recipe(s) ready to write.`,
  );

  // FINAL PHASE — write all files IN PARALLEL (fs.promises: mkdir + write).
  await Promise.all(
    writes.map(
      async ({
        file,
        outPath,
        content,
        craftedItem,
        ingredientItem,
        returnCount,
      }) => {
        try {
          if (settings.verbose) {
            console.log(
              `[generate_uncraft_table] [GENERATING] recipe: ${file} | source directory: ${path.dirname(file)} | output directory: ${path.dirname(outPath)} | file: ${outPath}`,
            );
          }
          await fsp.mkdir(path.dirname(outPath), { recursive: true });
          await safeWriteFile(outPath, content);
          stats.written++;
          if (settings.verbose) {
            console.log(
              `[generate_uncraft_table] [WRITTEN] ${outPath} | ${craftedItem} -> ${ingredientItem} x${returnCount}`,
            );
          }
        } catch (e) {
          console.error(
            `[generate_uncraft_table] Error writing ${outPath}: ${e.message}`,
          );
        }
      },
    ),
  );

  console.log(
    `[generate_uncraft_table] processed ${stats.processed} crafting table recipe(s) across ${roots.length} root director(y/ies); generated ${stats.written} uncraft recipe(s) in ${settings.outputDir}`,
  );
  console.log(
    `[generate_uncraft_table] skipped because they are not (only) crafting table recipes: ${stats.notCraftingTable}`,
  );
  console.log(
    `[generate_uncraft_table] skipped because they are not recipe_shaped/recipe_shapeless (furnace, smithing, brewing, etc.): ${stats.otherRecipeType}`,
  );
  if (stats.tagResolvedByWoodPattern > 0) {
    console.log(
      `[generate_uncraft_table] wood-tag ingredients without a defined type, automatically resolved to "${settings.defaultWoodType}": ${stats.tagResolvedByWoodPattern}`,
    );
  }
  if (stats.tagIngredientsSkipped > 0) {
    console.log(
      `[generate_uncraft_table] tag ingredients skipped because they have no single concrete item to return (not resolved by tagDefaults or wood-tag recognition): ${stats.tagIngredientsSkipped}`,
    );
  }
  if (stats.selfReferenceSkipped > 0) {
    console.log(
      `[generate_uncraft_table] ingredients skipped because they are the crafted item itself (self-reference): ${stats.selfReferenceSkipped}`,
    );
  }
  if (stats.excludedByItemList > 0) {
    console.log(
      `[generate_uncraft_table] recipes skipped by excludeItems: ${stats.excludedByItemList}`,
    );
  }
  if (stats.collapsedWoodVariants > 0) {
    console.log(
      `[generate_uncraft_table] wood variants collapsed into a single uncraft recipe (preferring "${settings.defaultWoodType}"): ${stats.collapsedWoodVariants}`,
    );
  }
  if (stats.skippedNoViableReturn > 0) {
    console.log(
      `[generate_uncraft_table] recipes with no viable return (returnRate/minPerIngredient rounded all values to zero): ${stats.skippedNoViableReturn}`,
    );
  }
  // Indexing is unlimited in this version, so no subdirectories are cut off
  // by depth. Keep this statistic only for compatibility with older versions.
  if (stats.directoryReadErrors > 0) {
    console.log(
      `[generate_uncraft_table] directories that could not be read and were skipped: ${stats.directoryReadErrors}`,
    );
  }
  if (stats.brokenSymlinksSkipped > 0) {
    console.log(
      `[generate_uncraft_table] broken symbolic links skipped: ${stats.brokenSymlinksSkipped}`,
    );
  }
  if (stats.parseErrors > 0) {
    console.log(
      `[generate_uncraft_table] files with parse errors: ${stats.parseErrors}`,
    );
  }
}

main().catch((e) => {
  console.error(
    `[generate_uncraft_table] fatal error: ${e && e.stack ? e.stack : e}`,
  );
  process.exitCode = 1;
});
