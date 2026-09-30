import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { gameProfiles } from "./schema";
import { DEFAULT_PROGRESS, normalizeProgress, type PlayerProgress } from "@/lib/game-progress";

export async function readProfile(userId: string): Promise<{ progress: PlayerProgress; exists: boolean }> {
  const row = await getDb().select().from(gameProfiles).where(eq(gameProfiles.userId, userId)).get();
  if (!row) return { progress: normalizeProgress(DEFAULT_PROGRESS), exists: false };
  try { return { progress: normalizeProgress(JSON.parse(row.progressJson)), exists: true }; }
  catch { return { progress: normalizeProgress(DEFAULT_PROGRESS), exists: true }; }
}

export async function writeProfile(userId: string, progress: PlayerProgress): Promise<void> {
  await getDb().insert(gameProfiles).values({
    userId,
    progressJson: JSON.stringify(progress),
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({ target: gameProfiles.userId, set: {
    progressJson: JSON.stringify(progress),
    updatedAt: new Date().toISOString(),
  } }).run();
}
