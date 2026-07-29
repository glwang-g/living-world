"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type TileType = "grass" | "tree" | "stone" | "water" | "dirt" | "wall" | "torch" | "unknown";
type Tile = { type: TileType; discovered?: boolean };
type Point = { x: number; y: number };
type LogEntry = { day: number; text: string; tone?: "danger" | "build" | "system" };
type Block = "wood" | "stone" | "dirt" | "torch";
type ServerSnapshot = { tick: number; origin_x: number; origin_y: number; width: number; height: number; blocks: TileType[]; player: Point; hp: number; inventory: Record<Block, number>; monsters: Point[]; sounds: string[]; night: boolean; sheltered: boolean; torch_lit: boolean };
type ServerEvent = { tick: number; actor: string; kind: string; location: Point | null; text: string };

const DEFAULT_WORLD_SIZE = 13;
const blockInfo: Record<Block, { label: string; icon: string }> = { wood: { label: "木墙", icon: "🪵" }, stone: { label: "石墙", icon: "⛰️" }, dirt: { label: "泥土", icon: "🟫" }, torch: { label: "火把", icon: "🔥" } };

function makeWorld(): Tile[][] {
  return Array.from({ length: DEFAULT_WORLD_SIZE }, (_, y) => Array.from({ length: DEFAULT_WORLD_SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === DEFAULT_WORLD_SIZE - 1 || y === DEFAULT_WORLD_SIZE - 1) return { type: "water" };
    if ((x * 11 + y * 7) % 23 === 0 || (x === 4 && y > 2 && y < 8)) return { type: "tree" };
    if ((x * 5 + y * 13) % 29 === 0) return { type: "stone" };
    if ((x * 3 + y * 5) % 17 === 0) return { type: "dirt" };
    return { type: "grass" };
  }));
}

const tileIcon: Record<TileType, string> = { grass: "", tree: "🌲", stone: "⛰️", water: "≈", dirt: "🟫", wall: "🧱", torch: "🔥", unknown: "" };
const SAVE_KEY = "living-world:blockworld:v1";
const initialLogs: LogEntry[] = [{ day: 1, text: "你在一片陌生的草地醒来。太阳正在落山，最好在夜晚前搭一面墙。", tone: "system" }];

export default function Home() {
  const [world, setWorld] = useState(makeWorld);
  const [worldOrigin, setWorldOrigin] = useState<Point>({ x: 0, y: 0 });
  const [player, setPlayer] = useState<Point>({ x: 9, y: 6 });
  const [hp, setHp] = useState(5);
  const [inventory, setInventory] = useState<Record<Block, number>>({ wood: 6, stone: 3, dirt: 12, torch: 4 });
  const [selected, setSelected] = useState<Block>("wood");
  const [action, setAction] = useState<"break" | "place">("break");
  const [tick, setTick] = useState(1);
  const [mode, setMode] = useState<"world" | "history">("world");
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [built, setBuilt] = useState(0);
  const [monsters, setMonsters] = useState<Point[]>([]);
  const [sounds, setSounds] = useState<string[]>([]);
  const [sheltered, setSheltered] = useState(false);
  const [torchLit, setTorchLit] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);
  const [viewColumns, setViewColumns] = useState(13);
  const [viewRows, setViewRows] = useState(13);
  const [coordinatesVisible, setCoordinatesVisible] = useState(false);
  const [hoveredCoordinate, setHoveredCoordinate] = useState<Point | null>(null);
  const cameraOriginRef = useRef<Point | null>(null);
  const worldRef = useRef(world);
  const noticeTimerRef = useRef<number | null>(null);
  const day = Math.floor((tick - 1) / 24) + 1;
  const hour = (tick - 1) % 24;
  const night = hour >= 16 || hour < 5;

  const applyServerSnapshot = (snapshot: ServerSnapshot) => {
    const serverOrigin = { x: snapshot.origin_x, y: snapshot.origin_y };
    const currentOrigin = cameraOriginRef.current ?? serverOrigin;
    const centerX = Math.floor(snapshot.width / 2); const centerY = Math.floor(snapshot.height / 2);
    const playerAt = { x: snapshot.player.x - currentOrigin.x, y: snapshot.player.y - currentOrigin.y };
    const edgeMarginX = Math.max(2, Math.floor(snapshot.width * 0.23)); const edgeMarginY = Math.max(2, Math.floor(snapshot.height * 0.23));
    const resized = snapshot.width !== (worldRef.current[0]?.length ?? 0) || snapshot.height !== worldRef.current.length;
    const shouldPan = resized || playerAt.x < edgeMarginX || playerAt.x > snapshot.width - 1 - edgeMarginX || playerAt.y < edgeMarginY || playerAt.y > snapshot.height - 1 - edgeMarginY;
    const origin = shouldPan ? { x: snapshot.player.x - centerX, y: snapshot.player.y - centerY } : currentOrigin;
    cameraOriginRef.current = origin;

    const incoming = new Map<string, TileType>();
    snapshot.blocks.forEach((type, index) => {
      const x = serverOrigin.x + (index % snapshot.width);
      const y = serverOrigin.y + Math.floor(index / snapshot.width);
      incoming.set(`${x},${y}`, type);
    });
    const nextWorld = Array.from({ length: snapshot.height }, (_, y) => Array.from({ length: snapshot.width }, (_, x) => {
      const absolute = `${origin.x + x},${origin.y + y}`;
      const observed = incoming.get(absolute);
      if (observed) return { type: observed };
      if (!shouldPan) return worldRef.current[y]?.[x] ?? { type: "unknown" as TileType };
      return { type: "unknown" as TileType };
    }));
    worldRef.current = nextWorld;
    setWorld(nextWorld);
    setWorldOrigin(origin);
    setPlayer({ x: snapshot.player.x - origin.x, y: snapshot.player.y - origin.y }); setHp(snapshot.hp); setInventory(snapshot.inventory); setTick(snapshot.tick); setMonsters(snapshot.monsters.map((monster) => ({ x: monster.x - origin.x, y: monster.y - origin.y }))); setSounds(snapshot.sounds); setSheltered(snapshot.sheltered); setTorchLit(snapshot.torch_lit); setServerOnline(true);
  };

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8787/api/snapshot?columns=${viewColumns}&rows=${viewRows}`, { cache: "no-store" });
        if (!response.ok) throw new Error("world server unavailable");
        const snapshot = await response.json() as ServerSnapshot;
        const eventResponse = await fetch("http://127.0.0.1:8787/api/events", { cache: "no-store" });
        const events = eventResponse.ok ? await eventResponse.json() as ServerEvent[] : [];
        if (!cancelled) {
          applyServerSnapshot(snapshot);
          if (events.length) setLogs(events.slice(-40).map((event) => ({ day: Math.floor((event.tick - 1) / 24) + 1, text: event.text, tone: event.kind === "night" || event.kind === "spawn" || event.kind === "damage" ? "danger" : event.kind === "building" || event.kind === "mining" || event.kind === "inventory" ? "build" : "system" })));
        }
      } catch { if (!cancelled) setServerOnline(false); }
      finally { if (!cancelled) setInitialSyncComplete(true); }
    };
    sync();
    const interval = window.setInterval(sync, 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [viewColumns, viewRows]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("app-ready", hydrated && initialSyncComplete);
  }, [hydrated, initialSyncComplete]);

  useEffect(() => {
    const updateViewRadius = () => {
      const consoleWidth = document.querySelector(".world-console")?.clientWidth ?? window.innerWidth;
      const targetTile = window.innerWidth > 850 ? 42 : 44;
      const columns = Math.max(13, Math.min(31, Math.floor(consoleWidth / targetTile)));
      const usableHeight = Math.max(420, window.innerHeight - (window.innerWidth > 850 ? 140 : 420));
      const rows = Math.max(9, Math.min(25, Math.floor(usableHeight / targetTile)));
      setViewColumns(columns); setViewRows(rows);
    };
    updateViewRadius(); window.addEventListener("resize", updateViewRadius);
    return () => window.removeEventListener("resize", updateViewRadius);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--world-columns", String(world[0]?.length ?? DEFAULT_WORLD_SIZE));
    document.documentElement.style.setProperty("--world-rows", String(world.length || DEFAULT_WORLD_SIZE));
  }, [world]);

  useEffect(() => {
    const onPointerMove = (event: MouseEvent) => {
      const tile = (event.target as HTMLElement).closest(".block-tile");
      const coordinates = tile?.getAttribute("aria-label")?.match(/^(-?\d+),(-?\d+)/);
      if (!coordinates) { setHoveredCoordinate(null); return; }
      setHoveredCoordinate({ x: Number(coordinates[1]) + (cameraOriginRef.current?.x ?? 0), y: Number(coordinates[2]) + (cameraOriginRef.current?.y ?? 0) });
    };
    document.addEventListener("mousemove", onPointerMove);
    return () => document.removeEventListener("mousemove", onPointerMove);
  }, []);

  useEffect(() => {
    const blockServerStatusClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest(".tool-toggle button:last-child")) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", blockServerStatusClick, true);
    return () => document.removeEventListener("click", blockServerStatusClick, true);
  }, []);

  useEffect(() => {
    const hint = document.querySelector(".world-hint");
    if (!hint) return;
    if (coordinatesVisible && hoveredCoordinate) { hint.classList.add("coordinate-mode"); hint.setAttribute("data-coordinate", ` · 光标坐标 ${hoveredCoordinate.x},${hoveredCoordinate.y}`); }
    else { hint.classList.remove("coordinate-mode"); hint.removeAttribute("data-coordinate"); }
  }, [coordinatesVisible, hoveredCoordinate]);

  useEffect(() => {
    const positionEventLog = () => {
      const worldConsole = document.querySelector(".world-console");
      const controls = document.querySelector(".controls-card");
      const eventLog = document.querySelector(".world-console > .log-strip") as HTMLElement | null;
      if (!worldConsole || !controls || !eventLog) return;
      const controlsBottom = controls.getBoundingClientRect().bottom;
      const consoleBottom = worldConsole.getBoundingClientRect().bottom;
      eventLog.style.top = `${controlsBottom - worldConsole.getBoundingClientRect().top}px`;
      eventLog.style.height = `${Math.max(140, consoleBottom - controlsBottom)}px`;
    };
    positionEventLog();
    const observer = new ResizeObserver(positionEventLog);
    const worldConsole = document.querySelector(".world-console");
    const controls = document.querySelector(".controls-card");
    if (worldConsole) observer.observe(worldConsole);
    if (controls) observer.observe(controls);
    window.addEventListener("resize", positionEventLog);
    return () => { observer.disconnect(); window.removeEventListener("resize", positionEventLog); };
  }, [world.length, logs.length]);

  const sendCommand = async (payload: Record<string, string | number>): Promise<boolean> => {
    if (!serverOnline) { log("世界服务尚未连接。请先启动 Rust world-server。", "danger"); return false; }
    try {
      const response = await fetch("http://127.0.0.1:8787/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) { log("世界服务拒绝了这个操作，请重启 world-server 后再试。", "danger"); return false; }
      const result = await response.json() as { accepted?: boolean };
      if (result.accepted !== true) { log("世界服务没有接受这个操作，请确认后端已更新。", "danger"); return false; }
      return true;
    } catch { setServerOnline(false); log("与世界服务的连接中断了。", "danger"); return false; }
  };

  useEffect(() => {
    const hydrate = () => {
      try {
        const saved = window.localStorage.getItem(SAVE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (Array.isArray(data.world)) { setWorld(data.world); worldRef.current = data.world; }
          if (data.player) setPlayer(data.player);
          if (typeof data.hp === "number") setHp(data.hp);
          if (data.inventory) setInventory(data.inventory);
          if (typeof data.selected === "string") setSelected(data.selected);
          if (typeof data.action === "string") setAction(data.action);
          if (typeof data.tick === "number") setTick(data.tick);
          if (typeof data.built === "number") setBuilt(data.built);
          if (Array.isArray(data.logs)) setLogs(data.logs);
          if (Array.isArray(data.monsters)) setMonsters(data.monsters);
        }
      } catch {
        // If an old or malformed save exists, start a clean game.
      } finally {
        setHydrated(true);
      }
    };
    const timer = window.setTimeout(hydrate, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ world, player, hp, inventory, selected, action, tick, built, logs, monsters }));
  }, [hydrated, world, player, hp, inventory, selected, action, tick, built, logs, monsters]);

  const log = (text: string, tone?: LogEntry["tone"]) => setLogs((current) => [...current, { day, text, tone }].slice(-40));
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2200);
  };
  const scrollToTop = () => window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  const replayTutorialPulse = () => {
    const tutorial = document.querySelector(".tutorial");
    if (!tutorial) return;
    tutorial.classList.remove("tutorial-pulse");
    void tutorial.clientWidth;
    tutorial.classList.add("tutorial-pulse");
    window.setTimeout(() => tutorial.classList.remove("tutorial-pulse"), 3800);
  };
  const resetGame = async () => {
    if (!window.confirm("确定要放弃当前世界，从第一天重新开始吗？")) return;
    if (serverOnline && !(await sendCommand({ command: "reset" }))) return;
    window.localStorage.removeItem(SAVE_KEY);
    const freshWorld = makeWorld(); worldRef.current = freshWorld; cameraOriginRef.current = { x: 0, y: 0 }; setWorld(freshWorld); setWorldOrigin({ x: 0, y: 0 }); setPlayer({ x: 9, y: 6 }); setHp(5); setInventory({ wood: 6, stone: 3, dirt: 12, torch: 4 }); setSelected("wood"); setAction("break"); setTick(6); setBuilt(0); setMonsters([]); setSounds([]); setSheltered(false); setTorchLit(false); setLogs(initialLogs);
  };
  const canReach = (x: number, y: number) => Math.abs(x - player.x) <= 1 && Math.abs(y - player.y) <= 1 && !(x === player.x && y === player.y);

  const move = (dx: number, dy: number) => {
    const x = player.x + dx; const y = player.y + dy; const tile = world[y]?.[x];
    if (tile && !["grass", "torch"].includes(tile.type)) {
      const label = tile.type === "wall" ? "墙" : tile.type === "tree" ? "树木" : tile.type === "stone" ? "石头" : tile.type === "dirt" ? "泥土" : "水面";
      const message = `${label}挡住了去路，先挖开它。`;
      showNotice(message); return;
    }
    if (serverOnline) {
      const direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
      void sendCommand({ command: "move", direction });
      return;
    }
    if (!tile) { showNotice("那里还没有被探索。先沿着已知区域前进。"); return; }
    setPlayer({ x, y });
    if (monsters.some((monster) => monster.x === x && monster.y === y)) { setHp((value) => Math.max(0, value - 1)); log("黑暗里的东西撞上了你，你受了伤。", "danger"); }
  };

  const editTile = (x: number, y: number) => {
    if (serverOnline) {
      if (!canReach(x, y)) { showNotice("距离太远了，先走近这一格。"); return; }
      void sendCommand(action === "break" ? { command: "break", x: x + worldOrigin.x, y: y + worldOrigin.y } : { command: "place", block: selected, x: x + worldOrigin.x, y: y + worldOrigin.y });
      return;
    }
    if (!canReach(x, y)) { showNotice("距离太远了，先走近这一格。"); return; }
    const tile = world[y][x];
    if (action === "break") {
      if (!["tree", "stone", "dirt", "wall", "torch"].includes(tile.type)) { showNotice("这块地方没有可以挖掘的材料。"); return; }
      const gain: Partial<Record<Block, number>> = tile.type === "tree" ? { wood: 2 } : tile.type === "stone" ? { stone: 1 } : tile.type === "dirt" ? { dirt: 2 } : tile.type === "torch" ? { torch: 1 } : {};
      setInventory((current) => ({ ...current, ...Object.fromEntries(Object.entries(gain).map(([key, value]) => [key, current[key as Block] + (value ?? 0)])) }));
      setWorld((current) => { const next = current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type: "grass" as TileType } : item)); worldRef.current = next; return next; });
      log(`你挖掉了${tile.type === "tree" ? "一棵树" : tile.type === "stone" ? "一块石头" : "一块方块"}，材料掉落在脚边。`, "build");
    } else {
      if (inventory[selected] <= 0) { showNotice(`你的${blockInfo[selected].label}用完了。`); return; }
      if (tile.type !== "grass" && tile.type !== "dirt") { showNotice("这里不是可以放置方块的空地。"); return; }
      const type: TileType = selected === "wood" ? "wall" : selected;
      setWorld((current) => { const next = current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type } : item)); worldRef.current = next; return next; });
      setInventory((current) => ({ ...current, [selected]: current[selected] - 1 }));
      setBuilt((value) => value + 1);
      log(`你放置了${blockInfo[selected].label}。一个可以躲避夜晚的地方正在成形。`, "build");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "w" || event.key === "ArrowUp") { event.preventDefault(); move(0, -1); }
      if (key === "s" || event.key === "ArrowDown") { event.preventDefault(); move(0, 1); }
      if (key === "a" || event.key === "ArrowLeft") { event.preventDefault(); move(-1, 0); }
      if (key === "d" || event.key === "ArrowRight") { event.preventDefault(); move(1, 0); }
      if (key === "e") setAction("break");
      if (key === "q") setAction("place");
      if (key === "c") setCoordinatesVisible((value) => !value);
      if (event.key === "?") setHelpOpen(true);
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!helpOpen) return;
    scrollToTop();
  }, [helpOpen]);

  const baseObjective = sheltered ? "你现在在封闭避难所内，可以安全观察夜晚。" : torchLit ? "火把照亮了周围，继续用墙体围出封闭避难所。" : night ? "夜晚来了：点亮火把，或继续搭建封闭避难所。" : `在夜晚前搭建封闭避难所（还需要 ${Math.max(0, 8 - built)} 个方块）`;
  const objective = sounds.length ? `${baseObjective} ${sounds.join(" ")}` : baseObjective;
  const nearby = useMemo(() => [world[player.y]?.[player.x - 1], world[player.y]?.[player.x + 1], world[player.y - 1]?.[player.x], world[player.y + 1]?.[player.x]].filter(Boolean).map((tile) => tile?.type).filter((type) => type !== "grass" && type !== "unknown"), [world, player.x, player.y]);

  return <main className="app-shell" onClickCapture={(event) => { const target = event.target as HTMLElement; const helpButton = target.closest(".help-button"); const miniHelp = target.closest(".mini-help"); if (miniHelp || helpButton) { scrollToTop(); replayTutorialPulse(); } }}>
    <header className="topbar"><div><p className="eyebrow">LIVING WORLD / BLOCKWORLD MVP</p><h1>苔原 · 第 {day} 天</h1><span className="subtitle">Rust 世界服务：{serverOnline ? "已连接，世界持续运行" : "未连接，请启动 world-server"}</span></div><div className="view-switch"><button className={`help-button ${helpOpen ? "active" : ""}`} aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}>❔ 新手说明</button><button className={mode === "world" ? "active" : ""} onClick={() => setMode("world")}>生存视角</button><button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}>世界历史</button></div></header>
    {helpOpen && <section className="tutorial" role="dialog" aria-label="新手说明"><div><p className="eyebrow">HOW TO PLAY</p><h2>三分钟了解这个世界</h2></div><button className="tutorial-close" onClick={() => setHelpOpen(false)}>关闭 ×</button><div className="tutorial-steps"><article><b>01</b><strong>先移动</strong><p>用 <kbd>WASD</kbd> 或方向键在方块世界里走动。你只能操作身边一格的方块。</p></article><article><b>02</b><strong>收集材料</strong><p>按 <kbd>E</kbd> 进入挖掘，点击身边一格的树、石头或泥土收集材料。</p></article><article><b>03</b><strong>搭建避难所</strong><p>按 <kbd>Q</kbd> 进入放置，点击相邻草地或泥土。用木墙、石墙和泥土围出封闭区域，避开夜里的怪物。</p></article><article><b>❗</b><strong>用火把过夜</strong><p>把火把放在避难所内部、入口和道路旁。火把照亮周围并保护居民，但不是武器；夜里仍要留意墙外的脚步声。</p></article></div></section>}
    {mode === "world" ? <section className="game-layout"><aside className="game-sidebar"><div className="status-card"><div className="avatar-player">你</div><h2>流浪者</h2><p>{night ? "❗ 夜晚 · 危险正在靠近" : "☀ 白天 · 适合探索和建造"}</p><div className="hearts">{"♥".repeat(hp)}<i>{"♡".repeat(5 - hp)}</i></div></div><div className="goal-card"><p className="eyebrow">❗ 当前目标</p><strong>{objective}</strong><small>附近：{nearby.length ? nearby.join("、") : "安静的草地"}</small></div><div className="inventory-card"><p className="eyebrow">背包</p>{(Object.keys(blockInfo) as Block[]).map((block) => <button title={`选择${blockInfo[block].label}`} className={`inventory-item ${selected === block ? "selected" : ""}`} key={block} onClick={() => setSelected(block)}><b>{blockInfo[block].icon}</b><span>{blockInfo[block].label}</span><em>{inventory[block]}</em></button>)}</div><div className="controls-card"><p className="eyebrow">操作</p><span><kbd>WASD</kbd> / 方向键移动</span><span><kbd>E</kbd> 挖掘　<kbd>Q</kbd> 放置</span><span>点击相邻方块执行动作</span><button className="mini-help" onClick={() => setHelpOpen(true)}>❔ 再看一遍教学</button><button className="mini-reset" onClick={resetGame}>重新开始这个世界</button></div></aside><section className="world-console"><div className="world-toolbar"><div><span className={`sun-dot ${night ? "moon" : ""}`}></span>{night ? "夜晚" : "白天"} · {String(hour).padStart(2, "0")}:00</div><div className="tool-toggle"><button className={action === "break" ? "active" : ""} onClick={() => setAction("break")}>挖掘</button><button className={action === "place" ? "active" : ""} onClick={() => setAction("place")}>放置 {blockInfo[selected].icon}</button><button disabled={!serverOnline} onClick={() => setServerOnline(false)}>{serverOnline ? "服务端运行中" : "等待服务端"}</button></div></div>{notice && <div className="world-notice" role="status">⚠ {notice}</div>}<div className={`block-world ${night ? "night" : ""}`} aria-label="可以移动和编辑的方块世界">{world.map((row, y) => row.map((tile, x) => { const monster = monsters.some((item) => item.x === x && item.y === y); const isPlayer = player.x === x && player.y === y; return <button key={`${x}-${y}`} className={`block-tile ${tile.type} ${isPlayer ? "player" : ""} ${monster ? "monster" : ""}`} onClick={() => editTile(x, y)} aria-label={`${x},${y} ${tile.type}`}>{isPlayer ? "●" : monster ? "☠" : tileIcon[tile.type]}</button>; }))}</div><div className="world-hint">{serverOnline ? (action === "break" ? "靠近一个资源方块，点击它来挖掘" : `靠近空地，点击放置${blockInfo[selected].label}`) : "等待 Rust world-server 连接后才能操作"} · 当前位置 {player.x},{player.y}</div><div className="log-strip"><div className="log-strip-head"><span>世界事件 · {logs.length}</span><button onClick={() => setShowAllLogs((value) => !value)}>{showAllLogs ? "收起" : "查看更多"}</button></div><div className={showAllLogs ? "log-list expanded" : "log-list"}>{logs.slice(showAllLogs ? -40 : -5).reverse().map((entry, index) => <p className={entry.tone ?? ""} key={`${entry.day}-${index}`}>第{entry.day}天　{entry.text}</p>)}</div></div></section></section> : <section className="history-page"><div className="history-head"><div><p className="eyebrow">WORLD EVENT STREAM</p><h2>这个世界是怎样被改变的</h2></div><span>所有行动都会留下记录</span></div><div className="history-grid"><div className="history-timeline">{logs.map((entry, index) => <article className={entry.tone ?? ""} key={`${entry.day}-${index}`}><span>第 {entry.day} 天</span><p>{entry.text}</p></article>)}</div><aside className="future-card"><p className="eyebrow">未来接口</p><h3>居民与自动化</h3><p>下一层可以让居民读取这条事件流：他们会看到你砍过的树、建过的墙，也会对夜晚留下自己的记忆。</p><p>再往后，玩家可以把重复动作交给可编程代理，逐渐走向 Screeps 的基地与自动化。</p><button onClick={() => setMode("world")}>回到世界</button></aside></div></section>}
  </main>;
}
