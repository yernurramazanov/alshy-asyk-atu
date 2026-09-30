"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CircleHelp,
  Coins,
  Crosshair,
  History,
  LockKeyhole,
  Medal,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_PROGRESS, normalizeProgress, SKINS, starsForRound, type ModeId, type PlayerProgress, type RoundResult, type SkinConfig, type SkinId } from "@/lib/game-progress";
import { languageFromBrowser, languageNames, translation, type Language, type ThemeChoice } from "@/lib/i18n";

type Screen = "home" | "modes" | "play" | "rules" | "shop";
type Phase = "aiming" | "charging" | "simulating" | "resolving" | "completed";

interface ModeConfig {
  id: ModeId;
  targetScore: number;
  maxThrows: number;
  requiredStreak?: number;
  layout: "line" | "cluster" | "split";
}

interface HudState {
  score: number;
  bestShot: number;
  throwsUsed: number;
  maxThrows: number;
  targetScore: number;
  streak: number;
  phase: Phase;
  lastKnocked: number;
}

const STORAGE_KEY = "alshy.progress.v1";

const MODES: ModeConfig[] = [
  { id: "tutorial", targetScore: 1, maxThrows: 4, layout: "cluster" },
  { id: "classic", targetScore: 8, maxThrows: 10, layout: "line" },
  { id: "first-hit", targetScore: 3, maxThrows: 4, layout: "cluster" },
  { id: "streak", targetScore: 2, maxThrows: 7, requiredStreak: 2, layout: "split" },
  { id: "marksman", targetScore: 8, maxThrows: 6, layout: "line" },
];

function loadLegacyProgress(): PlayerProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProgress(JSON.parse(raw)) : null;
  } catch { return null; }
}

async function progressRequest(action?: Record<string, unknown>) {
  const response = await fetch("/api/progress", action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  } : { cache: "no-store" });
  const data = await response.json() as { progress?: PlayerProgress; exists?: boolean; earnedCoins?: number; earnedStars?: number; error?: string };
  if (!response.ok || !data.progress) throw new Error(data.error ?? "Прогресс временно недоступен.");
  return data;
}

function modeById(id: ModeId) {
  return MODES.find((item) => item.id === id) ?? MODES[1];
}

function advice(result: RoundResult, language: Language) {
  const t = translation(language);
  if (result.won && result.accuracy >= 70) return t.advicePerfect;
  if (result.bestShot >= 3) return t.advicePower;
  if (result.accuracy < 35) return t.adviceAim;
  return result.won ? t.adviceWin : t.adviceLose;
}

function LogoMark() {
  return <span className="logo-mark" aria-hidden="true"><span /></span>;
}

function GameCanvas({
  mode,
  skin,
  roundKey,
  onHud,
  onComplete,
  onTutorialStep,
  language,
  theme,
}: {
  mode: ModeConfig;
  skin: SkinConfig;
  roundKey: number;
  onHud: (hud: HudState) => void;
  onComplete: (result: RoundResult) => void;
  onTutorialStep: (step: number) => void;
  language: Language;
  theme: "light" | "dark";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);
  const appearanceRef = useRef({ language, theme });
  appearanceRef.current = { language, theme };

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const module = await import("phaser");
      if (cancelled || !hostRef.current) return;
      const Phaser = module.default;
      const arena = { x: 480, y: 300, radius: 224 };
      const start = { x: 480, y: 572 };

      class AsykScene extends Phaser.Scene {
        private saka: any;
        private asyks: Array<any & { scored?: boolean }> = [];
        private aimGraphics: any;
        private phase: Phase = "aiming";
        private aimAngle = -90;
        private aimPower = 58;
        private score = 0;
        private throwsUsed = 0;
        private successfulThrows = 0;
        private bestShot = 0;
        private streak = 0;
        private settledSince = 0;
        private launchedAt = 0;
        private dragActive = false;
        private dragDistance = 0;
        private dragValid = false;
        private shotKnocked = 0;
        private activeKnocked: Array<any & { scored?: boolean }> = [];
        private tutorialStep = 0;
        private arenaGraphics: any;
        private arenaLabel: any;

        constructor() { super("asyk-scene"); }

        create() {
          this.createTextures();
          this.drawArena();
          this.spawnTargets();
          this.spawnSaka();
          this.aimGraphics = this.add.graphics().setDepth(20);
          this.bindInput();
          this.drawAim();
          this.emitHud(0);
          this.emitTutorial(0);
          this.game.events.on("appearance", this.drawArena, this);
        }

        shutdown() {
          this.input.removeAllListeners();
          this.game.events.off("appearance", this.drawArena, this);
        }

        private createTextures() {
          if (!this.textures.exists("asyk")) {
            const g = this.make.graphics({ x: 0, y: 0 });
            g.fillStyle(0xf5c76b, 1).fillRoundedRect(7, 6, 34, 18, 8);
            g.fillCircle(9, 9, 7).fillCircle(39, 21, 7);
            g.fillStyle(0xffe2a8, 0.9).fillEllipse(23, 11, 18, 6);
            g.generateTexture("asyk", 48, 30).destroy();
          }
          if (!this.textures.exists("saka")) {
            const g = this.make.graphics({ x: 0, y: 0 });
            g.fillStyle(0xffffff, 1).fillRoundedRect(8, 7, 42, 22, 10);
            g.fillCircle(11, 11, 9).fillCircle(47, 25, 9);
            g.lineStyle(3, 0x082f3f, 0.65).strokeRoundedRect(8, 7, 42, 22, 10);
            g.fillStyle(0xd8fff8, 0.9).fillEllipse(29, 13, 20, 7);
            g.generateTexture("saka", 58, 36).destroy();
          }
        }

        private drawArena() {
          const light = appearanceRef.current.theme === "light";
          const g = this.arenaGraphics ?? (this.arenaGraphics = this.add.graphics().setDepth(-1));
          g.clear();
          g.fillStyle(light ? 0xe8e3d5 : 0x071822, 1).fillRect(0, 0, 960, 640);
          g.fillStyle(0x7d241e, 1).fillCircle(arena.x, arena.y, arena.radius + 38);
          g.fillStyle(0xe3b65d, 1).fillCircle(arena.x, arena.y, arena.radius + 32);
          g.fillStyle(light ? 0x25515a : 0x0c3037, 1).fillCircle(arena.x, arena.y, arena.radius + 26);
          g.fillStyle(0xc98b47, 1).fillCircle(arena.x, arena.y, arena.radius);
          g.lineStyle(6, 0xf6ddaa, 0.98).strokeCircle(arena.x, arena.y, arena.radius);
          g.lineStyle(2, 0x9b2c23, 0.9).strokeCircle(arena.x, arena.y, arena.radius - 9);
          g.lineStyle(2, 0x744624, 0.6).lineBetween(arena.x - 182, arena.y, arena.x + 182, arena.y);
          g.lineStyle(2, 0x25d9c7, 0.55).lineBetween(308, 548, 652, 548);
          g.fillStyle(light ? 0x8a7e6e : 0x132f36, light ? 0.26 : 0.7);
          for (let i = 0; i < 34; i += 1) g.fillCircle((i * 83 + 29) % 930, (i * 47 + 61) % 620, i % 3 === 0 ? 2 : 1);
          const label = translation(appearanceRef.current.language).arenaRing;
          if (!this.arenaLabel) this.arenaLabel = this.add.text(480, 36, label, { fontFamily: "Arial", fontSize: "14px", color: light ? "#36555a" : "#f6ddaa", letterSpacing: 4 }).setOrigin(0.5);
          this.arenaLabel.setText(label).setColor(light ? "#36555a" : "#f6ddaa").setAlpha(light ? 0.85 : 0.72);
        }

        private positions() {
          if (mode.layout === "cluster") {
            return Array.from({ length: 15 }, (_, i) => ({ x: 408 + (i % 5) * 36 + (Math.floor(i / 5) % 2) * 10, y: 262 + Math.floor(i / 5) * 37 }));
          }
          if (mode.layout === "split") {
            return Array.from({ length: 15 }, (_, i) => ({ x: i < 8 ? 330 + i * 30 : 392 + (i - 8) * 30, y: i < 8 ? 280 : 332 }));
          }
          return Array.from({ length: 15 }, (_, i) => ({ x: 298 + i * 26, y: arena.y }));
        }

        private spawnTargets() {
          const colors = [0xf6c85f, 0xe89b4c, 0xf1b94f, 0xffd782];
          this.positions().forEach((position, i) => {
            const asyk = this.matter.add.image(position.x, position.y, "asyk", undefined, { frictionAir: 0.022, restitution: 0.84 }) as any & { scored?: boolean };
            asyk.setCircle(13).setMass(0.72).setFrictionAir(0.022).setBounce(0.84).setTint(colors[i % colors.length]);
            asyk.setAngle(i % 2 ? 180 : 0);
            asyk.scored = false;
            this.asyks.push(asyk);
          });
        }

        private spawnSaka() {
          this.saka = this.matter.add.image(start.x, start.y, "saka", undefined, { frictionAir: 0.016, restitution: 0.88 });
          this.saka.setCircle(18).setMass(skin.mass).setFrictionAir(0.016).setBounce(0.88).setDepth(10).setTint(skin.tint);
        }

        private bindInput() {
          this.input.on("pointerdown", (pointer: any) => {
            if (this.phase !== "aiming") return;
            if (Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, start.x, start.y) > 42) return;
            this.dragActive = true;
            this.dragDistance = 0;
            this.dragValid = false;
            this.phase = "charging";
            this.emitHud(0);
          });
          this.input.on("pointermove", (pointer: any) => {
            if (!this.dragActive || this.phase !== "charging") return;
            const dx = pointer.worldX - start.x;
            const dy = pointer.worldY - start.y;
            this.dragDistance = Math.hypot(dx, dy);
            this.dragValid = dy < -16;
            this.setAim(Phaser.Math.RadToDeg(Math.atan2(dy, dx)), Phaser.Math.Clamp((this.dragDistance / 175) * 100, 18, 100));
            this.emitTutorial(this.aimPower > 35 ? 2 : 1);
          });
          const release = () => {
            if (!this.dragActive) return;
            this.dragActive = false;
            if (this.dragDistance < 22 || !this.dragValid) {
              this.phase = "aiming";
              this.emitHud(0);
              this.drawAim();
              return;
            }
            this.shoot();
          };
          this.input.on("pointerup", release);
          this.input.on("pointerupoutside", release);
        }

        private setAim(nextAngle: number, nextPower: number) {
          this.aimAngle = Phaser.Math.Clamp(nextAngle, -155, -25);
          this.aimPower = Phaser.Math.Clamp(nextPower, 18, 100);
          this.drawAim();
        }

        private drawAim() {
          if (!this.aimGraphics || this.phase === "simulating" || this.phase === "resolving") return;
          const radians = Phaser.Math.DegToRad(this.aimAngle);
          const length = 76 + this.aimPower * 0.92;
          const endX = start.x + Math.cos(radians) * length;
          const endY = start.y + Math.sin(radians) * length;
          this.aimGraphics.clear().lineStyle(5, 0x25d9c7, 0.22).lineBetween(start.x, start.y, endX, endY);
          this.aimGraphics.lineStyle(2, 0xd8fff8, 0.92).lineBetween(start.x, start.y, endX, endY);
          this.aimGraphics.fillStyle(0xd8fff8, 0.95).fillCircle(endX, endY, 6);
          this.aimGraphics.lineStyle(3, 0x25d9c7, 0.8).strokeCircle(start.x, start.y, 28 + this.aimPower * 0.12);
        }

        private shoot() {
          if (this.phase !== "aiming" && this.phase !== "charging") return;
          this.phase = "simulating";
          this.throwsUsed += 1;
          this.shotKnocked = 0;
          this.activeKnocked = [];
          this.launchedAt = this.time.now;
          this.settledSince = 0;
          this.aimGraphics.clear();
          const radians = Phaser.Math.DegToRad(this.aimAngle);
          const speed = (12 + (this.aimPower / 100) * 24) * skin.speed;
          this.saka.setAwake();
          this.saka.setVelocity(Math.cos(radians) * speed, Math.sin(radians) * speed);
          this.saka.setAngularVelocity((this.aimAngle + 90) * 0.0018);
          this.emitHud(0);
          this.emitTutorial(3);
        }

        update(time: number) {
          if (this.phase !== "simulating") return;
          const newlyKnocked = this.asyks.filter((asyk) => !asyk.scored && Phaser.Math.Distance.Between(asyk.x, asyk.y, arena.x, arena.y) - 14 > arena.radius + 2);
          if (newlyKnocked.length) {
            newlyKnocked.forEach((asyk) => {
              asyk.scored = true;
              asyk.setTint(0x25d9c7);
              asyk.setFrictionAir(0.07);
              this.activeKnocked.push(asyk);
            });
            this.shotKnocked += newlyKnocked.length;
            this.score += newlyKnocked.length;
            this.emitHud(this.shotKnocked);
          }
          const allSlow = [this.saka, ...this.asyks.filter((asyk) => !asyk.scored)].every((body) => {
            const velocity = body.body?.velocity ?? { x: 0, y: 0 };
            return Math.hypot(velocity.x, velocity.y) < 0.16 && Math.abs(body.body?.angularVelocity ?? 0) < 0.025;
          });
          if (allSlow) {
            if (!this.settledSince) this.settledSince = time;
            if (time - this.settledSince > 520) this.resolveShot();
          } else this.settledSince = 0;
          if (time - this.launchedAt > 6200) this.resolveShot();
        }

        private resolveShot() {
          if (this.phase !== "simulating") return;
          this.phase = "resolving";
          const knocked = this.activeKnocked;
          knocked.forEach((asyk) => asyk.setStatic(true));
          const count = this.shotKnocked;
          this.bestShot = Math.max(this.bestShot, count);
          if (count) { this.successfulThrows += 1; this.streak += 1; } else this.streak = 0;
          const won = mode.id === "first-hit" ? this.bestShot >= 3 : mode.requiredStreak ? this.streak >= mode.requiredStreak : this.score >= mode.targetScore;
          if (won || this.throwsUsed >= mode.maxThrows) {
            this.phase = "completed";
            this.matter.world.pause();
            this.emitHud(count);
            const result: RoundResult = {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              mode: mode.id,
              score: this.score,
              throwsUsed: this.throwsUsed,
              successfulThrows: this.successfulThrows,
              accuracy: Math.round((this.successfulThrows / Math.max(1, this.throwsUsed)) * 100),
              won,
              bestShot: this.bestShot,
              createdAt: new Date().toISOString(),
            };
            this.time.delayedCall(480, () => this.game.events.emit("round:completed", result));
            return;
          }
          this.emitHud(count);
          this.time.delayedCall(430, () => {
            knocked.forEach((asyk) => { this.matter.world.remove(asyk.body); asyk.destroy(); });
            this.saka.setPosition(start.x, start.y).setVelocity(0, 0).setAngularVelocity(0).setAngle(0).setAwake();
            this.dragDistance = 0;
            this.phase = "aiming";
            this.emitHud(count);
            this.drawAim();
            this.emitTutorial(4);
          });
        }

        private emitTutorial(step: number) {
          this.tutorialStep = Math.max(this.tutorialStep, step);
          this.game.events.emit("tutorial:step", this.tutorialStep);
        }

        private emitHud(lastKnocked: number) {
          this.game.events.emit("hud", { score: this.score, bestShot: this.bestShot, throwsUsed: this.throwsUsed, maxThrows: mode.maxThrows, targetScore: mode.targetScore, streak: this.streak, phase: this.phase, lastKnocked } satisfies HudState);
        }
      }

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 960,
        height: 640,
        backgroundColor: "#071822",
        physics: { default: "matter", matter: { gravity: { x: 0, y: 0 }, enableSleeping: false, positionIterations: 10, velocityIterations: 8 } },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: AsykScene,
      });
      game.events.on("hud", onHud);
      game.events.on("round:completed", onComplete);
      game.events.on("tutorial:step", onTutorialStep);
      gameRef.current = game;
      game.events.emit("appearance");
    }

    void boot();
    return () => { cancelled = true; gameRef.current?.destroy(true); gameRef.current = null; };
  }, [mode, skin, roundKey, onComplete, onHud, onTutorialStep]);

  useEffect(() => { gameRef.current?.events.emit("appearance"); }, [language, theme]);

  return (
    <div className="game-stage-wrap">
      <div ref={hostRef} className="game-stage" aria-label={translation(language).arena} />
    </div>
  );
}

export default function GameApp() {
  const [language, setLanguage] = useState<Language>("ru");
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(true);
  const theme = themeChoice === "system" ? (systemDark ? "dark" : "light") : themeChoice;
  const t = translation(language);
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<ModeConfig>(MODES[1]);
  const [progress, setProgress] = useState<PlayerProgress>(DEFAULT_PROGRESS);
  const progressRef = useRef<PlayerProgress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  const [roundKey, setRoundKey] = useState(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [hud, setHud] = useState<HudState>({ score: 0, bestShot: 0, throwsUsed: 0, maxThrows: 10, targetScore: 8, streak: 0, phase: "aiming", lastKnocked: 0 });
  const [result, setResult] = useState<RoundResult | null>(null);
  const [reward, setReward] = useState<{ earnedCoins: number; earnedStars: number } | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [pendingSkin, setPendingSkin] = useState<SkinId | null>(null);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("alshy.language");
    setLanguage(savedLanguage === "kk" || savedLanguage === "ru" || savedLanguage === "en" ? savedLanguage : languageFromBrowser(navigator.language));
    const savedTheme = window.localStorage.getItem("alshy.theme");
    setThemeChoice(savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
  const chooseLanguage = (next: Language) => { window.localStorage.setItem("alshy.language", next); setLanguage(next); };
  const chooseTheme = (next: ThemeChoice) => { window.localStorage.setItem("alshy.theme", next); setThemeChoice(next); };

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let data = await progressRequest();
        const legacy = loadLegacyProgress();
        if (!data.exists && legacy) data = await progressRequest({ action: "import", legacy });
        if (active) { progressRef.current = data.progress!; setProgress(data.progress!); }
      } catch (error) {
        if (active) setProgressError(error instanceof Error ? error.message : "Прогресс временно недоступен.");
      } finally { if (active) setReady(true); }
    }
    void load();
    return () => { active = false; };
  }, []);

  const saveProgress = useCallback((next: PlayerProgress) => {
    progressRef.current = next;
    setProgress(next);
    setProgressError(null);
  }, []);

  const startMode = useCallback((selected: ModeConfig) => {
    setMode(selected);
    setHud({ score: 0, bestShot: 0, throwsUsed: 0, maxThrows: selected.maxThrows, targetScore: selected.targetScore, streak: 0, phase: "aiming", lastKnocked: 0 });
    setTutorialStep(0); setResult(null); setReward(null);
    setRoundKey((value) => value + 1);
    setScreen("play");
  }, []);

  const handleComplete = useCallback((roundResult: RoundResult) => {
    setResult(roundResult);
    setReward(null);
    void progressRequest({ action: "round", result: roundResult }).then((data) => {
      saveProgress(data.progress!);
      setReward({ earnedCoins: data.earnedCoins ?? 0, earnedStars: data.earnedStars ?? 0 });
    }).catch((error) => setProgressError(error instanceof Error ? error.message : "Не удалось сохранить результат."));
  }, [saveProgress]);

  const handleSkin = useCallback((skin: SkinConfig) => {
    if (pendingSkin) return;
    setPendingSkin(skin.id);
    const action = progressRef.current.ownedSkins.includes(skin.id) ? "equip" : "purchase";
    void progressRequest({ action, skinId: skin.id }).then((data) => saveProgress(data.progress!))
      .catch((error) => setProgressError(error instanceof Error ? error.message : "Не удалось обновить лавку."))
      .finally(() => setPendingSkin(null));
  }, [pendingSkin, saveProgress]);

  const nextChallenge = useMemo(() => {
    if (!result?.won) return null;
    if (result.mode === "first-hit") return modeById("streak");
    if (result.mode === "streak") return modeById("marksman");
    return null;
  }, [result]);

  if (!ready) return <main className="app-shell loading-shell">ALSHY</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("home")} type="button" aria-label={t.home}><LogoMark /><span><strong>ALSHY</strong><small>{t.tagline}</small></span></button>
        <div className="topbar-stats">
          <span className="wallet-balance"><Coins /> <strong>{progress.coins}</strong> {t.coins}</span>
          {screen !== "play" && <Button variant="ghost" className="topbar-shop" aria-label={t.shop} onClick={() => setScreen("shop")}><ShoppingBag /><span className="shop-label">{t.shop}</span></Button>}
          <span><Trophy /> {t.record} <strong>{progress.bestScore}</strong></span>
          <div className="preference-control"><label htmlFor="language-select">{t.language}</label><select id="language-select" value={language} onChange={(event) => chooseLanguage(event.target.value as Language)}>{(["kk", "ru", "en"] as const).map((value) => <option key={value} value={value}>{languageNames[value]}</option>)}</select></div>
          <div className="preference-control"><label htmlFor="theme-select">{t.theme}</label><select id="theme-select" value={themeChoice} onChange={(event) => chooseTheme(event.target.value as ThemeChoice)}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></div>
          <Button variant="ghost" size="icon" className="icon-button" aria-label={t.rules} onClick={() => setScreen("rules")}><CircleHelp /></Button>
        </div>
      </header>
      {progressError && <div className="progress-warning" role="status">{t.progressUnavailable} {screen === "shop" && t.purchasesUnavailable}</div>}

      {screen === "home" && (
        <section className="home-screen">
          <div className="home-copy">
            <p className="eyebrow">{t.homeEyebrow}</p>
            <h1>{t.homeTitle1}<br />{t.homeTitle2}</h1>
            <p className="home-lead">{t.homeLead}</p>
            <div className="home-actions">
              <Button className="primary-action" size="lg" onClick={() => startMode(modeById("tutorial"))}><BookOpen /> {t.startTutorial}</Button>
              <Button className="secondary-action" variant="outline" size="lg" onClick={() => setScreen("modes")}>{t.chooseMode}</Button>
            </div>
            <div className="quick-facts"><span><Crosshair /> {t.physics}</span><span><Star /> {t.masteryStars}</span><span><Coins /> {t.goalCoins}</span></div>
          </div>
          <div className="home-arena" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="display-saka"><span /></div><div className="target-row">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}</div><div className="arena-label"><span>8</span><small>{t.toVictory}</small></div></div>
          {progress.results.length > 0 && <aside className="recent-card"><p className="eyebrow"><History /> {t.lastRound}</p><strong>{progress.results[0].score} {t.knocked}</strong><span>{progress.results[0].won ? t.victory : t.tryAgain} · {progress.results[0].accuracy}% {t.accuracy}</span></aside>}
        </section>
      )}

      {screen === "modes" && (
        <section className="modes-screen page-panel">
          <div className="section-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("home")}><ArrowLeft /> {t.back}</Button><p className="eyebrow">{t.path}</p><h1>{t.modesTitle}</h1><p>{t.modesLead}</p></div>
          <div className="mode-grid">
            {MODES.filter((item) => item.id !== "tutorial").map((item) => {
              const challengeNumber = ["first-hit", "streak", "marksman"].indexOf(item.id);
              const locked = challengeNumber >= 0 && challengeNumber + 1 > progress.unlockedLevel;
              const stars = progress.stars[item.id] ?? 0;
              return <article className={`mode-card ${locked ? "is-locked" : ""}`} key={item.id}><div className="mode-card-top"><span>{t.modes[item.id][0]}</span><small>{t.modes[item.id][3]}</small></div><div className="mode-symbol">{locked ? <LockKeyhole /> : item.id === "classic" ? <Target /> : <Sparkles />}</div><h2>{t.modes[item.id][1]}</h2><p>{t.modes[item.id][2]}</p><div className="star-rating" aria-label={`${stars} ${t.starsOf}`}>{[0, 1, 2].map((index) => <Star key={index} className={index < stars ? "earned" : ""} />)}</div><p className="star-hint">{item.id === "classic" ? t.starClassic : item.id === "first-hit" ? t.starFirst : item.id === "streak" ? t.starStreak : t.starMarksman}</p><Button disabled={locked} onClick={() => startMode(item)}>{locked ? t.locked : t.play}</Button></article>;
            })}
          </div>
        </section>
      )}

      {screen === "shop" && (
        <section className="shop-screen page-panel">
          <div className="section-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("home")}><ArrowLeft /> {t.home}</Button><p className="eyebrow">{t.collection}</p><h1>{t.shop}</h1><p>{t.shopLead}</p></div>
          <div className="shop-balance"><Coins /><span>{t.balance}</span><strong>{progress.coins} {t.coins}</strong></div>
          <div className="shop-grid">{SKINS.map((skin) => {
            const owned = progress.ownedSkins.includes(skin.id);
            const equipped = progress.equippedSkin === skin.id;
            return <article className={`shop-card ${equipped ? "is-equipped" : ""}`} key={skin.id}>
              <div className="shop-card-top"><span className="skin-swatch" style={{ backgroundColor: `#${skin.tint.toString(16).padStart(6, "0")}` }} /><span>{equipped ? t.selected : owned ? t.unlocked : `${skin.price} ${t.coins}`}</span></div>
              <h2>{t.skins[skin.id][0]}</h2><p>{t.skins[skin.id][1]}</p>
              <Button disabled={equipped || Boolean(pendingSkin) || Boolean(progressError) || (!owned && progress.coins < skin.price)} onClick={() => handleSkin(skin)}>{equipped ? t.using : pendingSkin === skin.id ? t.saving : owned ? t.select : progress.coins < skin.price ? t.notEnough : t.buy}</Button>
            </article>;
          })}</div>
          <p className="shop-footnote">{t.shopFootnote}</p>
        </section>
      )}

      {screen === "rules" && (
        <section className="rules-screen page-panel">
          <div className="section-heading rules-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("home")}><ArrowLeft /> {t.back}</Button><p className="eyebrow">{t.rulesEyebrow}</p><h1>{t.rulesTitle}</h1></div>
          <div className="rules-layout">
            <article className="rule-lead"><span className="rule-number">01</span><h2>{t.rule1Title}</h2><p>{t.rule1}</p></article>
            <article><span className="rule-number">02</span><h2>{t.rule2Title}</h2><p>{t.rule2}</p></article>
            <article><span className="rule-number">03</span><h2>{t.rule3Title}</h2><p>{t.rule3}</p></article>
            <article><span className="rule-number">04</span><h2>{t.rule4Title}</h2><p>{t.rule4}</p></article>
          </div>
          <Button className="primary-action rules-start" onClick={() => startMode(modeById("tutorial"))}><BookOpen /> {t.tryTutorial}</Button>
        </section>
      )}

      {screen === "play" && (
        <section className="play-screen">
          <div className="play-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("modes")}><ArrowLeft /> {t.modesLabel}</Button><div><span>{t.modes[mode.id][0]}</span><strong>{t.modes[mode.id][1]}</strong></div><div className="phase-pill">{hud.phase === "simulating" ? t.moving : hud.phase === "resolving" ? t.resolving : hud.phase === "completed" ? t.completed : t.yourShot}</div></div>
          <div className="game-layout">
            <aside className="hud-card score-card"><p className="eyebrow">{t.result}</p><div className="big-score"><strong>{mode.id === "first-hit" ? hud.bestShot : mode.requiredStreak ? hud.streak : hud.score}</strong><span>/ {mode.requiredStreak ?? hud.targetScore}</span></div><p>{mode.id === "first-hit" ? t.oneShot : mode.requiredStreak ? t.streakScore : t.asyksKnocked}</p><Progress value={Math.min(100, ((mode.id === "first-hit" ? hud.bestShot : mode.requiredStreak ? hud.streak : hud.score) / (mode.requiredStreak ?? hud.targetScore)) * 100)} /><div className="throws-row"><span>{t.throws}</span><strong>{hud.throwsUsed} / {hud.maxThrows}</strong></div><div className="throws-dots">{Array.from({ length: hud.maxThrows }, (_, index) => <i className={index < hud.throwsUsed ? "used" : ""} key={index} />)}</div></aside>
            <div className="stage-column">
              {mode.id === "tutorial" && <div className="tutorial-banner"><span>{Math.min(tutorialStep + 1, 4)} / 4</span><p>{t.tutorialSteps[tutorialStep]}</p></div>}
              <GameCanvas mode={mode} skin={SKINS.find((item) => item.id === progress.equippedSkin) ?? SKINS[0]} roundKey={roundKey} onHud={setHud} onComplete={handleComplete} onTutorialStep={setTutorialStep} language={language} theme={theme} />
              <p className="stage-hint">{t.stageHint}</p>
            </div>
            <aside className="hud-card gesture-card"><p className="eyebrow">{t.dragShot}</p><div className="gesture-mark"><span className="mini-saka" /><i /></div><h3>{t.aimRelease}</h3><p>{t.gesture}</p><div className="control-note"><Crosshair /><p>{t.aimTip}</p></div></aside>
          </div>
          {result && <div className="result-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title"><article className="result-card"><div className={`result-icon ${result.won ? "won" : ""}`}>{result.won ? <Trophy /> : <Target />}</div><p className="eyebrow">{t.completed}</p><h2 id="result-title">{result.won ? t.winTitle : t.loseTitle}</h2><p className="result-copy">{advice(result, language)}</p><div className="result-stats"><span><strong>{result.score}</strong><small>{t.knocked}</small></span><span><strong>{result.accuracy}%</strong><small>{t.accuracy}</small></span><span><strong>{result.bestShot}</strong><small>{t.bestShot}</small></span></div><div className="reward-row">{result.mode !== "tutorial" && <span className="reward-stars" aria-label={`${starsForRound(result)} ${t.starsOf}`}>{[0, 1, 2].map((index) => <Star key={index} className={index < starsForRound(result) ? "earned" : ""} />)}</span>}<span><Coins /> {reward ? reward.earnedCoins > 0 ? `+${reward.earnedCoins} ${t.coins}` : t.noNewCoins : progressError ? t.rewardNotSaved : t.countingReward}</span></div><div className="result-actions">{nextChallenge && <Button className="primary-action" onClick={() => startMode(nextChallenge)}>{t.nextChallenge}</Button>}<Button variant={nextChallenge ? "outline" : "default"} onClick={() => startMode(mode)}><RotateCcw /> {t.playAgain}</Button><Button variant="ghost" onClick={() => setScreen("modes")}>{t.toModes}</Button><Button variant="ghost" onClick={() => setScreen("shop")}><ShoppingBag /> {t.shop}</Button></div></article></div>}
        </section>
      )}
    </main>
  );
}
