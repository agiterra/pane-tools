/**
 * Themed pane name generator.
 *
 * Each tab can have a theme. When a pane is created without a name,
 * the system picks from the theme's pool, excluding names already in use.
 */

/** Name pools by theme. ~20 names each, enough for any realistic pane count. */
const POOLS: Record<string, string[]> = {
  trees: [
    // Hardwoods (architectural millwork staples)
    "walnut", "oak", "cherry", "maple", "ash",
    "birch", "elm", "alder", "beech", "hickory",
    // Softwoods
    "cedar", "pine", "spruce", "fir", "hemlock",
    // Exotics
    "teak", "mahogany", "ebony", "rosewood", "bamboo",
  ],
  rivers: [
    "thames", "seine", "danube", "rhine", "tigris",
    "nile", "ganges", "volga", "amazon", "missouri",
    "yukon", "loire", "elbe", "don", "ohio",
    "platte", "snake", "rouge", "pearl", "verde",
  ],
  stones: [
    "granite", "marble", "slate", "basalt", "quartz",
    "obsidian", "flint", "jasper", "onyx", "agate",
    "pumice", "shale", "gneiss", "chalk", "dolomite",
    "travertine", "sandstone", "limestone", "soapstone", "feldspar",
  ],
  peaks: [
    "rainier", "denali", "shasta", "hood", "baker",
    "whitney", "elbert", "olympus", "logan", "robson",
    "fuji", "blanc", "elbrus", "rosa", "matterhorn",
    "cook", "vinson", "kailash", "ararat", "sinai",
  ],
  spices: [
    "saffron", "cardamom", "cumin", "cinnamon", "clove",
    "nutmeg", "ginger", "turmeric", "paprika", "sumac",
    "anise", "fennel", "coriander", "thyme", "oregano",
    "basil", "sage", "tarragon", "dill", "caraway",
  ],
  cities: [
    // European
    "rome", "paris", "vienna", "prague", "lisbon",
    "florence", "barcelona", "bruges", "edinburgh", "zurich",
    // Americas
    "boston", "savannah", "havana", "montreal", "lima",
    // Africa & Middle East
    "cairo", "marrakech", "istanbul", "beirut", "nairobi",
  ],
};

/** All available theme names. */
export const THEME_NAMES = Object.keys(POOLS);

/**
 * Pick an unused name from a theme's pool.
 * Returns null if the theme is unknown or the pool is exhausted.
 */
export function pickName(theme: string, usedNames: string[]): string | null {
  const pool = POOLS[theme];
  if (!pool) return null;
  const used = new Set(usedNames);
  const available = pool.filter((n) => !used.has(n));
  if (available.length === 0) return null;
  return available[0];
}

/**
 * Check if a theme name is valid.
 */
export function isValidTheme(theme: string): boolean {
  return theme in POOLS;
}

/**
 * Resolve background image path for a themed pane.
 * Images live at ~/.wire/themes/<theme>/<name>.jpg
 * Returns null if the image doesn't exist.
 */
export function backgroundImagePath(theme: string, name: string): string | null {
  const { existsSync } = require("fs");
  const { join } = require("path");
  const base = join(process.env.HOME ?? "/tmp", ".wire", "themes", theme);
  // Check for common extensions
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const path = join(base, `${name}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}
