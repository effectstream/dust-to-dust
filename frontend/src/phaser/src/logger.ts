// Categorized logging utility using console.
// Categories can be enabled or disabled via the VITE_LOG_CATEGORIES environment variable (comma-separated).
// Example: VITE_LOG_CATEGORIES=combat-logic,ui,network
// If VITE_LOG_CATEGORIES is not set, all categories are enabled by default.

export enum LogCategory {
  CombatLogic = 'combat-logic',
  UI = 'ui',
  Network = 'network',
  GameState = 'game-state',
  AssetLoading = 'asset-loading',
  UserInput = 'user-input',
  Animation = 'animation',
  Audio = 'audio',
  Debug = 'debugging',
}

export interface CategoryLogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

function makeCategoryLogger(category: string, enabled: boolean): CategoryLogger {
  if (!enabled) {
    return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }
  return {
    debug: (message: string, ...args: any[]) => console.debug(`[${category}]`, message, ...args),
    info: (message: string, ...args: any[]) => console.info(`[${category}]`, message, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[${category}]`, message, ...args),
    error: (message: string, ...args: any[]) => console.error(`[${category}]`, message, ...args),
  };
}

class GameLogger {
  private enabledCategories: Set<LogCategory>;
  private categoryLoggers: Map<LogCategory, CategoryLogger>;

  constructor() {
    const categoriesEnv = import.meta.env.VITE_LOG_CATEGORIES as string;
    this.enabledCategories = new Set();

    if (categoriesEnv) {
      const categories = categoriesEnv.split(',').map(cat => cat.trim() as LogCategory);
      categories.forEach(cat => this.enabledCategories.add(cat));
    } else {
      this.enabledCategories = new Set(Object.values(LogCategory));
    }

    this.categoryLoggers = new Map();
    for (const category of Object.values(LogCategory)) {
      this.categoryLoggers.set(category, makeCategoryLogger(category, this.enabledCategories.has(category)));
    }
  }

  get combat(): CategoryLogger { return this.categoryLoggers.get(LogCategory.CombatLogic)!; }
  get ui(): CategoryLogger { return this.categoryLoggers.get(LogCategory.UI)!; }
  get network(): CategoryLogger { return this.categoryLoggers.get(LogCategory.Network)!; }
  get gameState(): CategoryLogger { return this.categoryLoggers.get(LogCategory.GameState)!; }
  get assetLoading(): CategoryLogger { return this.categoryLoggers.get(LogCategory.AssetLoading)!; }
  get userInput(): CategoryLogger { return this.categoryLoggers.get(LogCategory.UserInput)!; }
  get animation(): CategoryLogger { return this.categoryLoggers.get(LogCategory.Animation)!; }
  get audio(): CategoryLogger { return this.categoryLoggers.get(LogCategory.Audio)!; }
  get debugging(): CategoryLogger { return this.categoryLoggers.get(LogCategory.Debug)!; }

  category(category: LogCategory): CategoryLogger {
    return this.categoryLoggers.get(category)!;
  }

  info(message: string, ...args: any[]) { console.info(message, ...args); }
  warn(message: string, ...args: any[]) { console.warn(message, ...args); }
  error(message: string, ...args: any[]) { console.error(message, ...args); }
  debug(message: string, ...args: any[]) { console.debug(message, ...args); }

  isEnabled(category: LogCategory): boolean {
    return this.enabledCategories.has(category);
  }
}

// Export singleton instance
export const logger = new GameLogger();
