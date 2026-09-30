import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameProfiles = sqliteTable("game_profiles", {
  userId: text("user_id").primaryKey(),
  progressJson: text("progress_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
