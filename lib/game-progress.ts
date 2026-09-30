export type ModeId = "tutorial" | "classic" | "first-hit" | "streak" | "marksman";
export type SkinId = "turquoise" | "wood" | "bronze" | "silver";

export interface RoundResult {
  id: string;
  mode: ModeId;
  score: number;
  throwsUsed: number;
  successfulThrows: number;
  accuracy: number;
  won: boolean;
  bestShot: number;
  createdAt: string;
}

export interface PlayerProgress {
  bestScore: number;
  tutorialCompleted: boolean;
  unlockedLevel: number;
  results: RoundResult[];
  coins: number;
  stars: Partial<Record<ModeId, number>>;
  ownedSkins: SkinId[];
  equippedSkin: SkinId;
}

export interface SkinConfig {
  id: SkinId;
  title: string;
  description: string;
  price: number;
  tint: number;
  mass: number;
  speed: number;
}

export const SKINS: SkinConfig[] = [
  { id: "turquoise", title: "Бирюзовый", description: "Знакомый сақа с ровным, предсказуемым броском.", price: 0, tint: 0x25d9c7, mass: 4.4, speed: 1 },
  { id: "wood", title: "Резное дерево", description: "Новый облик для классического броска.", price: 40, tint: 0xd7a55f, mass: 4.4, speed: 1 },
  { id: "bronze", title: "Қола", description: "Тяжелее: сильнее удар, но медленнее полёт.", price: 80, tint: 0xda8450, mass: 5.6, speed: 0.88 },
  { id: "silver", title: "Күміс", description: "Быстрее летит, но передаёт меньше импульса.", price: 100, tint: 0xc9e6e9, mass: 3.5, speed: 1.08 },
];

export const DEFAULT_PROGRESS: PlayerProgress = {
  bestScore: 0,
  tutorialCompleted: false,
  unlockedLevel: 1,
  results: [],
  coins: 0,
  stars: {},
  ownedSkins: ["turquoise"],
  equippedSkin: "turquoise",
};

export function normalizeProgress(value: unknown): PlayerProgress {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROGRESS, results: [], stars: {}, ownedSkins: ["turquoise"] };
  const raw = value as Partial<PlayerProgress>;
  const validIds = new Set(SKINS.map((skin) => skin.id));
  const owned = Array.isArray(raw.ownedSkins) ? raw.ownedSkins.filter((id): id is SkinId => validIds.has(id)) : [];
  const ownedSkins = Array.from(new Set<SkinId>(["turquoise", ...owned]));
  const stars: PlayerProgress["stars"] = {};
  for (const mode of ["classic", "first-hit", "streak", "marksman"] as const) {
    const count = Number(raw.stars?.[mode]);
    if (Number.isFinite(count)) stars[mode] = Math.max(0, Math.min(3, Math.floor(count)));
  }
  return {
    bestScore: Math.max(0, Math.min(15, Number(raw.bestScore) || 0)),
    tutorialCompleted: Boolean(raw.tutorialCompleted),
    unlockedLevel: Math.max(1, Math.min(4, Number(raw.unlockedLevel) || 1)),
    results: Array.isArray(raw.results) ? raw.results.slice(0, 8) : [],
    coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
    stars,
    ownedSkins,
    equippedSkin: ownedSkins.includes(raw.equippedSkin as SkinId) ? raw.equippedSkin as SkinId : "turquoise",
  };
}

export function starsForRound(result: RoundResult): number {
  if (!result.won || result.mode === "tutorial") return 0;
  if (result.mode === "first-hit") return result.bestShot >= 5 ? 3 : result.bestShot >= 4 ? 2 : 1;
  if (result.mode === "streak") return result.throwsUsed <= 3 ? 3 : result.throwsUsed <= 5 ? 2 : 1;
  if (result.mode === "marksman") return result.throwsUsed <= 3 ? 3 : result.throwsUsed <= 4 ? 2 : 1;
  return result.throwsUsed <= 3 ? 3 : result.throwsUsed <= 6 ? 2 : 1;
}

export function validRound(result: unknown): result is RoundResult {
  if (!result || typeof result !== "object") return false;
  const value = result as Partial<RoundResult>;
  return typeof value.id === "string" && value.id.length <= 80 &&
    ["tutorial", "classic", "first-hit", "streak", "marksman"].includes(value.mode ?? "") &&
    Number.isInteger(value.score) && value.score! >= 0 && value.score! <= 15 &&
    Number.isInteger(value.throwsUsed) && value.throwsUsed! >= 1 && value.throwsUsed! <= 10 &&
    Number.isInteger(value.successfulThrows) && value.successfulThrows! >= 0 && value.successfulThrows! <= value.throwsUsed! &&
    Number.isInteger(value.bestShot) && value.bestShot! >= 0 && value.bestShot! <= value.score! &&
    typeof value.won === "boolean" && typeof value.createdAt === "string";
}

export function awardRound(current: PlayerProgress, result: RoundResult) {
  if (current.results.some((item) => item.id === result.id)) return { progress: current, earnedCoins: 0, earnedStars: 0 };
  const achievedStars = starsForRound(result);
  const previousStars = current.stars[result.mode] ?? 0;
  const earnedStars = Math.max(0, achievedStars - previousStars);
  const tutorialBonus = result.mode === "tutorial" && result.won && !current.tutorialCompleted ? 20 : 0;
  const earnedCoins = earnedStars * 20 + tutorialBonus;
  const challengeIndex = ["first-hit", "streak", "marksman"].indexOf(result.mode);
  const unlockedLevel = result.won && challengeIndex >= 0 ? Math.max(current.unlockedLevel, Math.min(4, challengeIndex + 2)) : current.unlockedLevel;
  return {
    progress: {
      ...current,
      bestScore: Math.max(current.bestScore, result.score),
      tutorialCompleted: current.tutorialCompleted || (result.mode === "tutorial" && result.won),
      unlockedLevel,
      coins: current.coins + earnedCoins,
      stars: { ...current.stars, [result.mode]: Math.max(previousStars, achievedStars) },
      results: [result, ...current.results].slice(0, 8),
    },
    earnedCoins,
    earnedStars,
  };
}
