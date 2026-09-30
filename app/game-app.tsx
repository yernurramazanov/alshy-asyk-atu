"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CircleHelp,
  Crosshair,
  Gauge,
  History,
  LockKeyhole,
  Medal,
  RotateCcw,
  Sparkles,
  Target,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";

type Screen = "home" | "modes" | "play" | "rules";
type Phase = "aiming" | "charging" | "simulating" | "resolving" | "completed";
type ModeId = "tutorial" | "classic" | "first-hit" | "streak" | "marksman";

interface ModeConfig {
  id: ModeId;
  eyebrow: string;
  title: string;
  description: string;
  targetScore: number;
  maxThrows: number;
  requiredStreak?: number;
  layout: "line" | "cluster" | "split";
  difficulty: string;
}

interface HudState {
  score: number;
  throwsUsed: number;
  maxThrows: number;
  targetScore: number;
  streak: number;
  phase: Phase;
  lastKnocked: number;
}

interface RoundResult {
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

interface PlayerProgress {
  bestScore: number;
  tutorialCompleted: boolean;
  unlockedLevel: number;
  results: RoundResult[];
}

const STORAGE_KEY = "alshy.progress.v1";
const DEFAULT_PROGRESS: PlayerProgress = { bestScore: 0, tutorialCompleted: false, unlockedLevel: 1, results: [] };

const MODES: ModeConfig[] = [
  { id: "tutorial", eyebrow: "3 шага", title: "Обучение", description: "Освой прицел, силу и первый точный бросок.", targetScore: 1, maxThrows: 4, layout: "cluster", difficulty: "Начало" },
  { id: "classic", eyebrow: "Основной режим", title: "Классический раунд", description: "Выбей 8 из 15 асыков за 10 бросков.", targetScore: 8, maxThrows: 10, layout: "line", difficulty: "Стандарт" },
  { id: "first-hit", eyebrow: "Испытание 1", title: "Первый удар", description: "Выбей 3 асыка за 5 бросков.", targetScore: 3, maxThrows: 5, layout: "cluster", difficulty: "Легко" },
  { id: "streak", eyebrow: "Испытание 2", title: "Серия", description: "Сделай два результативных броска подряд.", targetScore: 2, maxThrows: 7, requiredStreak: 2, layout: "split", difficulty: "Средне" },
  { id: "marksman", eyebrow: "Испытание 3", title: "Нағыз мерген", description: "Выбей 8 асыков, имея только 8 бросков.", targetScore: 8, maxThrows: 8, layout: "line", difficulty: "Сложно" },
];

function loadProgress(): PlayerProgress {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const saved = JSON.parse(raw) as Partial<PlayerProgress>;
    return {
      bestScore: Math.max(0, Number(saved.bestScore) || 0),
      tutorialCompleted: Boolean(saved.tutorialCompleted),
      unlockedLevel: Math.min(4, Math.max(1, Number(saved.unlockedLevel) || 1)),
      results: Array.isArray(saved.results) ? saved.results.slice(0, 8) : [],
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function modeById(id: ModeId) {
  return MODES.find((item) => item.id === id) ?? MODES[1];
}

function advice(result: RoundResult) {
  if (result.won && result.accuracy >= 70) return "Точный раунд. Пора переходить к следующему испытанию.";
  if (result.bestShot >= 3) return "Сильный бросок. Повтори угол и немного уменьши разброс силы.";
  if (result.accuracy < 35) return "Сначала выровняй направление, затем добавляй силу.";
  return result.won ? "Хороший темп. Теперь попробуй победить меньшим числом бросков." : "Целься в край центральной группы — импульс пройдёт через несколько асыков.";
}

function LogoMark() {
  return <span className="logo-mark" aria-hidden="true"><span /></span>;
}

function GameCanvas({
  mode,
  roundKey,
  angle,
  power,
  onAim,
  onHud,
  onComplete,
  onTutorialStep,
}: {
  mode: ModeConfig;
  roundKey: number;
  angle: number;
  power: number;
  onAim: (angle: number, power: number) => void;
  onHud: (hud: HudState) => void;
  onComplete: (result: RoundResult) => void;
  onTutorialStep: (step: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);

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
        private tutorialStep = 0;

        constructor() { super("asyk-scene"); }

        create() {
          this.createTextures();
          this.drawArena();
          this.spawnTargets();
          this.spawnSaka();
          this.aimGraphics = this.add.graphics().setDepth(20);
          this.bindInput();
          this.game.events.on("control:setAim", this.handleSetAim, this);
          this.game.events.on("control:shoot", this.shoot, this);
          this.input.keyboard?.on("keydown-LEFT", () => this.setAim(this.aimAngle - 3, this.aimPower));
          this.input.keyboard?.on("keydown-RIGHT", () => this.setAim(this.aimAngle + 3, this.aimPower));
          this.input.keyboard?.on("keydown-UP", () => this.setAim(this.aimAngle, this.aimPower + 4));
          this.input.keyboard?.on("keydown-DOWN", () => this.setAim(this.aimAngle, this.aimPower - 4));
          this.input.keyboard?.on("keydown-SPACE", () => this.shoot());
          this.drawAim();
          this.emitHud(0);
          this.emitTutorial(0);
        }

        shutdown() {
          this.game.events.off("control:setAim", this.handleSetAim, this);
          this.game.events.off("control:shoot", this.shoot, this);
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
            g.fillStyle(0x25d9c7, 1).fillRoundedRect(8, 7, 42, 22, 10);
            g.fillCircle(11, 11, 9).fillCircle(47, 25, 9);
            g.lineStyle(3, 0x082f3f, 0.65).strokeRoundedRect(8, 7, 42, 22, 10);
            g.fillStyle(0xd8fff8, 0.9).fillEllipse(29, 13, 20, 7);
            g.generateTexture("saka", 58, 36).destroy();
          }
        }

        private drawArena() {
          const g = this.add.graphics();
          g.fillStyle(0x071822, 1).fillRect(0, 0, 960, 640);
          g.fillStyle(0x0c2630, 1).fillCircle(arena.x, arena.y, arena.radius + 32);
          g.fillStyle(0xc98b47, 1).fillCircle(arena.x, arena.y, arena.radius);
          g.lineStyle(5, 0xf6ddaa, 0.95).strokeCircle(arena.x, arena.y, arena.radius);
          g.lineStyle(2, 0x744624, 0.6).lineBetween(arena.x - 182, arena.y, arena.x + 182, arena.y);
          g.lineStyle(2, 0x25d9c7, 0.55).lineBetween(308, 548, 652, 548);
          g.fillStyle(0x132f36, 0.7);
          for (let i = 0; i < 34; i += 1) g.fillCircle((i * 83 + 29) % 930, (i * 47 + 61) % 620, i % 3 === 0 ? 2 : 1);
          this.add.text(480, 36, "СЫРТҚЫ ШЕҢБЕР", { fontFamily: "Arial", fontSize: "14px", color: "#f6ddaa", letterSpacing: 4 }).setOrigin(0.5).setAlpha(0.72);
        }

        private positions() {
          if (mode.layout === "cluster") {
            return Array.from({ length: 15 }, (_, i) => ({ x: 424 + (i % 5) * 28 + (Math.floor(i / 5) % 2) * 12, y: 270 + Math.floor(i / 5) * 31 }));
          }
          if (mode.layout === "split") {
            return Array.from({ length: 15 }, (_, i) => ({ x: i < 8 ? 330 + i * 30 : 392 + (i - 8) * 30, y: i < 8 ? 280 : 332 }));
          }
          return Array.from({ length: 15 }, (_, i) => ({ x: 298 + i * 26, y: arena.y }));
        }

        private spawnTargets() {
          const colors = [0xf6c85f, 0xe89b4c, 0xf1b94f, 0xffd782];
          this.positions().forEach((position, i) => {
            const asyk = this.matter.add.image(position.x, position.y, "asyk", undefined, { frictionAir: 0.04, restitution: 0.72 });
            asyk.setCircle(13).setMass(1).setFrictionAir(0.04).setBounce(0.72).setTint(colors[i % colors.length]);
            asyk.setAngle(i % 2 ? 180 : 0);
            asyk.scored = false;
            this.asyks.push(asyk);
          });
        }

        private spawnSaka() {
          this.saka = this.matter.add.image(start.x, start.y, "saka", undefined, { frictionAir: 0.028, restitution: 0.76 });
          this.saka.setCircle(18).setMass(3.4).setFrictionAir(0.028).setBounce(0.76).setDepth(10);
        }

        private bindInput() {
          this.input.on("pointerdown", (pointer: any) => {
            if (this.phase !== "aiming") return;
            if (Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, start.x, start.y) > 105) return;
            this.dragActive = true;
            this.phase = "charging";
            this.emitHud(0);
          });
          this.input.on("pointermove", (pointer: any) => {
            if (!this.dragActive || this.phase !== "charging") return;
            const dx = start.x - pointer.worldX;
            const dy = start.y - pointer.worldY;
            this.setAim(Phaser.Math.RadToDeg(Math.atan2(dy, dx)), Phaser.Math.Clamp((Math.hypot(dx, dy) / 145) * 100, 18, 100));
            this.emitTutorial(this.aimPower > 35 ? 2 : 1);
          });
          this.input.on("pointerup", () => {
            if (!this.dragActive) return;
            this.dragActive = false;
            this.shoot();
          });
        }

        private handleSetAim(payload: unknown) {
          if (this.phase !== "aiming" && this.phase !== "charging") return;
          const next = payload as { angle?: number; power?: number };
          this.setAim(next.angle ?? this.aimAngle, next.power ?? this.aimPower);
          this.emitTutorial((next.power ?? this.aimPower) > 35 ? 2 : 1);
        }

        private setAim(nextAngle: number, nextPower: number) {
          this.aimAngle = Phaser.Math.Clamp(nextAngle, -155, -25);
          this.aimPower = Phaser.Math.Clamp(nextPower, 18, 100);
          this.drawAim();
          onAim(Math.round(this.aimAngle), Math.round(this.aimPower));
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
          this.launchedAt = this.time.now;
          this.settledSince = 0;
          this.aimGraphics.clear();
          const radians = Phaser.Math.DegToRad(this.aimAngle);
          const speed = 8 + (this.aimPower / 100) * 18;
          this.saka.setVelocity(Math.cos(radians) * speed, Math.sin(radians) * speed);
          this.saka.setAngularVelocity((this.aimAngle + 90) * 0.0018);
          this.emitHud(0);
          this.emitTutorial(3);
        }

        update(time: number) {
          if (this.phase !== "simulating") return;
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
          const knocked = this.asyks.filter((asyk) => !asyk.scored && Phaser.Math.Distance.Between(asyk.x, asyk.y, arena.x, arena.y) - 14 > arena.radius + 2);
          knocked.forEach((asyk) => { asyk.scored = true; asyk.setTint(0x25d9c7); asyk.setStatic(true); });
          const count = knocked.length;
          this.score += count;
          this.bestShot = Math.max(this.bestShot, count);
          if (count) { this.successfulThrows += 1; this.streak += 1; } else this.streak = 0;
          const won = mode.requiredStreak ? this.streak >= mode.requiredStreak : this.score >= mode.targetScore;
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
          this.game.events.emit("hud", { score: this.score, throwsUsed: this.throwsUsed, maxThrows: mode.maxThrows, targetScore: mode.targetScore, streak: this.streak, phase: this.phase, lastKnocked } satisfies HudState);
        }
      }

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 960,
        height: 640,
        backgroundColor: "#071822",
        physics: { default: "matter", matter: { gravity: { x: 0, y: 0 }, enableSleeping: true, positionIterations: 10, velocityIterations: 8 } },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: AsykScene,
      });
      game.events.on("hud", onHud);
      game.events.on("round:completed", onComplete);
      game.events.on("tutorial:step", onTutorialStep);
      gameRef.current = game;
    }

    void boot();
    return () => { cancelled = true; gameRef.current?.destroy(true); gameRef.current = null; };
  }, [mode, roundKey, onAim, onComplete, onHud, onTutorialStep]);

  useEffect(() => { gameRef.current?.events.emit("control:setAim", { angle, power }); }, [angle, power]);

  return (
    <div className="game-stage-wrap">
      <div ref={hostRef} className="game-stage" aria-label="Игровое поле асық ату" />
      <button className="canvas-shoot" onClick={() => gameRef.current?.events.emit("control:shoot")} type="button">Бросить сақа</button>
    </div>
  );
}

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<ModeConfig>(MODES[1]);
  const [progress, setProgress] = useState<PlayerProgress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  const [roundKey, setRoundKey] = useState(0);
  const [angle, setAngle] = useState(-90);
  const [power, setPower] = useState(58);
  const [muted, setMuted] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [hud, setHud] = useState<HudState>({ score: 0, throwsUsed: 0, maxThrows: 10, targetScore: 8, streak: 0, phase: "aiming", lastKnocked: 0 });
  const [result, setResult] = useState<RoundResult | null>(null);

  useEffect(() => { setProgress(loadProgress()); setReady(true); }, []);

  const saveProgress = useCallback((next: PlayerProgress) => {
    setProgress(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* keep playing */ }
  }, []);

  const handleAim = useCallback((nextAngle: number, nextPower: number) => {
    setAngle(nextAngle);
    setPower(nextPower);
  }, []);

  const startMode = useCallback((selected: ModeConfig) => {
    setMode(selected);
    setHud({ score: 0, throwsUsed: 0, maxThrows: selected.maxThrows, targetScore: selected.targetScore, streak: 0, phase: "aiming", lastKnocked: 0 });
    setAngle(-90); setPower(58); setTutorialStep(0); setResult(null);
    setRoundKey((value) => value + 1);
    setScreen("play");
  }, []);

  const handleComplete = useCallback((roundResult: RoundResult) => {
    setResult(roundResult);
    const challengeIndex = ["first-hit", "streak", "marksman"].indexOf(roundResult.mode);
    const unlockedLevel = roundResult.won && challengeIndex >= 0 ? Math.max(progress.unlockedLevel, Math.min(4, challengeIndex + 2)) : progress.unlockedLevel;
    saveProgress({
      bestScore: Math.max(progress.bestScore, roundResult.score),
      tutorialCompleted: progress.tutorialCompleted || roundResult.mode === "tutorial",
      unlockedLevel,
      results: [roundResult, ...progress.results].slice(0, 8),
    });
  }, [progress, saveProgress]);

  const nextChallenge = useMemo(() => {
    if (!result?.won) return null;
    if (result.mode === "first-hit") return modeById("streak");
    if (result.mode === "streak") return modeById("marksman");
    return null;
  }, [result]);

  if (!ready) return <main className="app-shell loading-shell">Подготавливаем площадку…</main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("home")} type="button" aria-label="На главную"><LogoMark /><span><strong>ALSHY</strong><small>цифровой асық ату</small></span></button>
        <div className="topbar-stats">
          <span><Trophy /> Рекорд <strong>{progress.bestScore}</strong></span>
          <Button variant="ghost" size="icon" className="icon-button" aria-label={muted ? "Включить звук" : "Выключить звук"} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX /> : <Volume2 />}</Button>
          <Button variant="ghost" size="icon" className="icon-button" aria-label="Правила" onClick={() => setScreen("rules")}><CircleHelp /></Button>
        </div>
      </header>

      {screen === "home" && (
        <section className="home-screen">
          <div className="home-copy">
            <p className="eyebrow">Традиция в твоих руках</p>
            <h1>Прицелься.<br />Почувствуй бросок.</h1>
            <p className="home-lead">Выбей асыки за границу круга с помощью сақа. Здесь решают угол, сила и точность — не случайность.</p>
            <div className="home-actions">
              <Button className="primary-action" size="lg" onClick={() => startMode(modeById("tutorial"))}><BookOpen /> Начать обучение</Button>
              <Button className="secondary-action" variant="outline" size="lg" onClick={() => setScreen("modes")}>Выбрать режим</Button>
            </div>
            <div className="quick-facts"><span><Crosshair /> Честная физика</span><span><Target /> 15 асыков</span><span><Medal /> Цель — выбить 8</span></div>
          </div>
          <div className="home-arena" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="display-saka"><span /></div><div className="target-row">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}</div><div className="arena-label"><span>8</span><small>асыков до победы</small></div></div>
          {progress.results.length > 0 && <aside className="recent-card"><p className="eyebrow"><History /> Последний раунд</p><strong>{progress.results[0].score} выбито</strong><span>{progress.results[0].won ? "Победа" : "Попробуй ещё"} · {progress.results[0].accuracy}% точности</span></aside>}
        </section>
      )}

      {screen === "modes" && (
        <section className="modes-screen page-panel">
          <div className="section-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("home")}><ArrowLeft /> Назад</Button><p className="eyebrow">Твой путь</p><h1>Выбери режим</h1><p>Начни с техники, затем проверь точность в испытаниях.</p></div>
          <div className="mode-grid">
            {MODES.filter((item) => item.id !== "tutorial").map((item) => {
              const challengeNumber = ["first-hit", "streak", "marksman"].indexOf(item.id);
              const locked = challengeNumber >= 0 && challengeNumber + 1 > progress.unlockedLevel;
              return <article className={`mode-card ${locked ? "is-locked" : ""}`} key={item.id}><div className="mode-card-top"><span>{item.eyebrow}</span><small>{item.difficulty}</small></div><div className="mode-symbol">{locked ? <LockKeyhole /> : item.id === "classic" ? <Target /> : <Sparkles />}</div><h2>{item.title}</h2><p>{item.description}</p><Button disabled={locked} onClick={() => startMode(item)}>{locked ? "Сначала пройди предыдущий" : "Играть"}</Button></article>;
            })}
          </div>
        </section>
      )}

      {screen === "rules" && (
        <section className="rules-screen page-panel">
          <div className="section-heading rules-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("home")}><ArrowLeft /> Назад</Button><p className="eyebrow">Коротко о главном</p><h1>Как играть</h1></div>
          <div className="rules-layout">
            <article className="rule-lead"><span className="rule-number">01</span><h2>Сақа — твой снаряд</h2><p>Потяни бирюзовый сақа назад, выбери направление и отпусти.</p></article>
            <article><span className="rule-number">02</span><h2>Выбивай за круг</h2><p>Асык засчитывается, только когда полностью пересёк светлую границу.</p></article>
            <article><span className="rule-number">03</span><h2>Считай броски</h2><p>В классическом раунде нужно выбить 8 из 15 асыков за 10 попыток.</p></article>
            <article><span className="rule-number">04</span><h2>Улучшай точность</h2><p>Результат зависит от угла, силы и точки первого столкновения.</p></article>
          </div>
          <Button className="primary-action rules-start" onClick={() => startMode(modeById("tutorial"))}><BookOpen /> Попробовать в обучении</Button>
        </section>
      )}

      {screen === "play" && (
        <section className="play-screen">
          <div className="play-heading"><Button variant="ghost" className="back-button" onClick={() => setScreen("modes")}><ArrowLeft /> Режимы</Button><div><span>{mode.eyebrow}</span><strong>{mode.title}</strong></div><div className="phase-pill">{hud.phase === "simulating" ? "Сақа в движении" : hud.phase === "resolving" ? "Считаем результат" : "Твой бросок"}</div></div>
          <div className="game-layout">
            <aside className="hud-card score-card"><p className="eyebrow">Результат</p><div className="big-score"><strong>{mode.requiredStreak ? hud.streak : hud.score}</strong><span>/ {mode.requiredStreak ?? hud.targetScore}</span></div><p>{mode.requiredStreak ? "серия точных бросков" : "асыков выбито"}</p><Progress value={Math.min(100, ((mode.requiredStreak ? hud.streak : hud.score) / (mode.requiredStreak ?? hud.targetScore)) * 100)} /><div className="throws-row"><span>Броски</span><strong>{hud.throwsUsed} / {hud.maxThrows}</strong></div><div className="throws-dots">{Array.from({ length: hud.maxThrows }, (_, index) => <i className={index < hud.throwsUsed ? "used" : ""} key={index} />)}</div></aside>
            <div className="stage-column">
              {mode.id === "tutorial" && <div className="tutorial-banner"><span>{Math.min(tutorialStep + 1, 4)} / 4</span><p>{["Потяни сақа назад, чтобы выбрать направление.", "Меняй угол — линия показывает будущий бросок.", "Добавь силы и отпусти сақа.", "Дождись остановки и посмотри результат.", "Отлично. Теперь выбей один асык за круг."][tutorialStep]}</p></div>}
              <GameCanvas mode={mode} roundKey={roundKey} angle={angle} power={power} onAim={handleAim} onHud={setHud} onComplete={handleComplete} onTutorialStep={setTutorialStep} />
              <p className="stage-hint">Потяни сақа назад и отпусти · ← → меняют угол, ↑ ↓ — силу, пробел — бросок</p>
            </div>
            <aside className="hud-card controls-card"><p className="eyebrow">Точный контроль</p><div className="control-label"><span><Crosshair /> Угол</span><strong>{angle}°</strong></div><Slider min={-155} max={-25} step={1} value={[angle]} onValueChange={(value) => setAngle(value[0])} disabled={["simulating", "resolving", "completed"].includes(hud.phase)} /><div className="control-label power-label"><span><Gauge /> Сила</span><strong>{power}%</strong></div><Slider min={18} max={100} step={1} value={[power]} onValueChange={(value) => setPower(value[0])} disabled={["simulating", "resolving", "completed"].includes(hud.phase)} /><div className="power-scale"><span>Мягко</span><span>Сильно</span></div><div className="control-note"><span className="mini-saka" /><p>Бирюзовый асык — твой сақа. Целься в край группы, чтобы передать импульс дальше.</p></div></aside>
          </div>
          {result && <div className="result-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title"><article className="result-card"><div className={`result-icon ${result.won ? "won" : ""}`}>{result.won ? <Trophy /> : <Target />}</div><p className="eyebrow">Раунд завершён</p><h2 id="result-title">{result.won ? "Жеңіс! Победа" : "Ещё один точный бросок"}</h2><p className="result-copy">{advice(result)}</p><div className="result-stats"><span><strong>{result.score}</strong><small>выбито</small></span><span><strong>{result.accuracy}%</strong><small>точность</small></span><span><strong>{result.bestShot}</strong><small>лучший бросок</small></span></div><div className="result-actions">{nextChallenge && <Button className="primary-action" onClick={() => startMode(nextChallenge)}>Следующее испытание</Button>}<Button variant={nextChallenge ? "outline" : "default"} onClick={() => startMode(mode)}><RotateCcw /> Сыграть ещё</Button><Button variant="ghost" onClick={() => setScreen("modes")}>К режимам</Button></div></article></div>}
        </section>
      )}
    </main>
  );
}
