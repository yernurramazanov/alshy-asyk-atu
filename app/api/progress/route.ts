import { getChatGPTUser } from "@/app/chatgpt-auth";
import { readProfile, writeProfile } from "@/db/profile";
import { awardRound, normalizeProgress, SKINS, validRound } from "@/lib/game-progress";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Войдите, чтобы сохранять прогресс." }, { status: 401 });
  try {
    const { progress, exists } = await readProfile(user.userId);
    return Response.json({ progress, exists });
  } catch (error) {
    console.error("Failed to load game progress", error);
    return Response.json({ error: "Прогресс временно недоступен." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Войдите, чтобы сохранять прогресс." }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }

  try {
    const { progress: current, exists } = await readProfile(user.userId);
    if (input.action === "import") {
      if (exists) return Response.json({ progress: current, earnedCoins: 0, earnedStars: 0 });
      const old = normalizeProgress(input.legacy);
      const progress = {
        ...current,
        bestScore: old.bestScore,
        tutorialCompleted: old.tutorialCompleted,
        unlockedLevel: old.unlockedLevel,
        results: old.results.filter(validRound).slice(0, 8),
        coins: old.tutorialCompleted ? 20 : 0,
      };
      await writeProfile(user.userId, progress);
      return Response.json({ progress, earnedCoins: 0, earnedStars: 0 });
    }
    if (input.action === "round") {
      if (!validRound(input.result)) return Response.json({ error: "Некорректный результат." }, { status: 400 });
      const result = input.result;
      const achieved = result.mode === "tutorial" ? result.score >= 1
        : result.mode === "first-hit" ? result.bestShot >= 3
        : result.mode === "streak" ? result.successfulThrows >= 2
        : result.mode === "marksman" ? result.score >= 8 && result.throwsUsed <= 6
        : result.score >= 8;
      const limits = { tutorial: 4, classic: 10, "first-hit": 4, streak: 7, marksman: 6 };
      if (result.throwsUsed > limits[result.mode] || (result.won && !achieved) || (result.mode !== "streak" && result.won !== achieved)) {
        return Response.json({ error: "Результат не совпадает с правилами." }, { status: 400 });
      }
      const reward = awardRound(current, result);
      await writeProfile(user.userId, reward.progress);
      return Response.json(reward);
    }
    if (input.action === "purchase") {
      const skin = SKINS.find((item) => item.id === input.skinId && item.price > 0);
      if (!skin || current.ownedSkins.includes(skin.id) || current.coins < skin.price) {
        return Response.json({ error: "Покупка недоступна." }, { status: 400 });
      }
      const progress = { ...current, coins: current.coins - skin.price, ownedSkins: [...current.ownedSkins, skin.id], equippedSkin: skin.id };
      await writeProfile(user.userId, progress);
      return Response.json({ progress });
    }
    if (input.action === "equip") {
      const skin = SKINS.find((item) => item.id === input.skinId);
      if (!skin || !current.ownedSkins.includes(skin.id)) return Response.json({ error: "Сначала открой этот сақа." }, { status: 400 });
      const progress = { ...current, equippedSkin: skin.id };
      await writeProfile(user.userId, progress);
      return Response.json({ progress });
    }
    return Response.json({ error: "Неизвестное действие." }, { status: 400 });
  } catch (error) {
    console.error("Failed to update game progress", error);
    return Response.json({ error: "Не удалось сохранить прогресс. Попробуйте ещё раз." }, { status: 503 });
  }
}
