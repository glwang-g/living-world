"use client";

import { useEffect, useMemo, useState } from "react";

type TileType = "grass" | "tree" | "stone" | "water" | "dirt" | "wall" | "torch";
type Tile = { type: TileType; discovered?: boolean };
type Point = { x: number; y: number };
type LogEntry = { day: number; text: string; tone?: "danger" | "build" | "system" };
type Block = "wood" | "stone" | "dirt" | "torch";
type ServerSnapshot = { tick: number; width: number; height: number; blocks: TileType[]; player: Point; hp: number; inventory: Record<Block, number>; monsters: Point[]; night: boolean };
type ServerEvent = { tick: number; actor: string; kind: string; location: Point | null; text: string };

const WIDTH = 20;
const HEIGHT = 12;
const blockInfo: Record<Block, { label: string; icon: string }> = { wood: { label: "木墙", icon: "▦" }, stone: { label: "石墙", icon: "◆" }, dirt: { label: "泥土", icon: "▪" }, torch: { label: "火把", icon: "♨" } };

function makeWorld(): Tile[][] {
  return Array.from({ length: HEIGHT }, (_, y) => Array.from({ length: WIDTH }, (_, x) => {
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) return { type: "water" };
    if ((x * 11 + y * 7) % 23 === 0 || (x === 4 && y > 2 && y < 8)) return { type: "tree" };
    if ((x * 5 + y * 13) % 29 === 0) return { type: "stone" };
    if ((x * 3 + y * 5) % 17 === 0) return { type: "dirt" };
    return { type: "grass" };
  }));
}

const tileIcon: Record<TileType, string> = { grass: "", tree: "♣", stone: "◆", water: "≈", dirt: "▪", wall: "▦", torch: "♨" };
const SAVE_KEY = "living-world:blockworld:v1";
const initialLogs: LogEntry[] = [{ day: 1, text: "你在一片陌生的草地醒来。太阳正在落山，最好在夜晚前搭一面墙。", tone: "system" }];

export default function Home() {
  const [world, setWorld] = useState(makeWorld);
  const [player, setPlayer] = useState<Point>({ x: 9, y: 6 });
  const [hp, setHp] = useState(5);
  const [inventory, setInventory] = useState<Record<Block, number>>({ wood: 6, stone: 3, dirt: 12, torch: 4 });
  const [selected, setSelected] = useState<Block>("wood");
  const [action, setAction] = useState<"break" | "place">("break");
  const [tick, setTick] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<"world" | "history">("world");
  const [helpOpen, setHelpOpen] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [built, setBuilt] = useState(0);
  const [monsters, setMonsters] = useState<Point[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [hydrated, setHydrated] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const day = Math.floor((tick - 1) / 24) + 1;
  const hour = (tick - 1) % 24;
  const night = hour >= 16 || hour < 5;
  const currentTile = world[player.y]?.[player.x];

  const applyServerSnapshot = (snapshot: ServerSnapshot) => {
    setWorld(Array.from({ length: snapshot.height }, (_, y) => snapshot.blocks.slice(y * snapshot.width, (y + 1) * snapshot.width).map((type) => ({ type }))));
    setPlayer(snapshot.player); setHp(snapshot.hp); setInventory(snapshot.inventory); setTick(snapshot.tick); setMonsters(snapshot.monsters); setServerOnline(true);
  };

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8787/api/snapshot", { cache: "no-store" });
        if (!response.ok) throw new Error("world server unavailable");
        const snapshot = await response.json() as ServerSnapshot;
        const eventResponse = await fetch("http://127.0.0.1:8787/api/events", { cache: "no-store" });
        const events = eventResponse.ok ? await eventResponse.json() as ServerEvent[] : [];
        if (!cancelled) {
          applyServerSnapshot(snapshot);
          if (events.length) setLogs(events.slice(-40).map((event) => ({ day: Math.floor((event.tick - 1) / 24) + 1, text: event.text, tone: event.kind === "night" || event.kind === "spawn" || event.kind === "damage" ? "danger" : event.kind === "building" || event.kind === "mining" || event.kind === "inventory" ? "build" : "system" })));
        }
      } catch { if (!cancelled) setServerOnline(false); }
    };
    sync();
    const interval = window.setInterval(sync, 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

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
    try {
      const saved = window.localStorage.getItem(SAVE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data.world)) setWorld(data.world);
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
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ world, player, hp, inventory, selected, action, tick, built, logs, monsters }));
  }, [hydrated, world, player, hp, inventory, selected, action, tick, built, logs, monsters]);

  const log = (text: string, tone?: LogEntry["tone"]) => setLogs((current) => [...current, { day, text, tone }].slice(-40));
  const resetGame = async () => {
    if (!window.confirm("确定要放弃当前世界，从第一天重新开始吗？")) return;
    if (serverOnline && !(await sendCommand({ command: "reset" }))) return;
    window.localStorage.removeItem(SAVE_KEY);
    setWorld(makeWorld()); setPlayer({ x: 9, y: 6 }); setHp(5); setInventory({ wood: 6, stone: 3, dirt: 12, torch: 4 }); setSelected("wood"); setAction("break"); setTick(6); setBuilt(0); setMonsters([]); setLogs(initialLogs); setRunning(true);
  };
  const canReach = (x: number, y: number) => Math.abs(x - player.x) <= 1 && Math.abs(y - player.y) <= 1 && !(x === player.x && y === player.y);

  const move = (dx: number, dy: number) => {
    if (serverOnline) {
      const direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
      void sendCommand({ command: "move", direction });
      return;
    }
    const x = player.x + dx; const y = player.y + dy; const tile = world[y]?.[x];
    if (!tile || tile.type === "water" || tile.type === "wall") return log("那里过不去。", "system");
    setPlayer({ x, y });
    if (monsters.some((monster) => monster.x === x && monster.y === y)) { setHp((value) => Math.max(0, value - 1)); log("黑暗里的东西撞上了你，你受了伤。", "danger"); }
  };

  const editTile = (x: number, y: number) => {
    if (serverOnline) {
      if (!canReach(x, y)) return log("你够不到那里。先走近一点。", "system");
      void sendCommand(action === "break" ? { command: "break", x, y } : { command: "place", block: selected, x, y });
      return;
    }
    if (!canReach(x, y)) return log("你够不到那里。先走近一点。", "system");
    const tile = world[y][x];
    if (action === "break") {
      if (!["tree", "stone", "dirt", "wall", "torch"].includes(tile.type)) return log("这块草地什么也没有。", "system");
      const gain: Partial<Record<Block, number>> = tile.type === "tree" ? { wood: 2 } : tile.type === "stone" ? { stone: 1 } : tile.type === "dirt" ? { dirt: 2 } : tile.type === "torch" ? { torch: 1 } : {};
      setInventory((current) => ({ ...current, ...Object.fromEntries(Object.entries(gain).map(([key, value]) => [key, current[key as Block] + (value ?? 0)])) }));
      setWorld((current) => current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type: "grass" } : item)));
      log(`你挖掉了${tile.type === "tree" ? "一棵树" : tile.type === "stone" ? "一块石头" : "一块方块"}，材料掉落在脚边。`, "build");
    } else {
      if (inventory[selected] <= 0) return log(`你的${blockInfo[selected].label}用完了。`, "system");
      if (tile.type !== "grass" && tile.type !== "dirt") return log("这里没有可以放置方块的空地。", "system");
      const type: TileType = selected === "wood" ? "wall" : selected;
      setWorld((current) => current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type } : item)));
      setInventory((current) => ({ ...current, [selected]: current[selected] - 1 }));
      setBuilt((value) => value + 1);
      log(`你放置了${blockInfo[selected].label}。一个可以躲避夜晚的地方正在成形。`, "build");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "w" || event.key === "ArrowUp") move(0, -1);
      if (key === "s" || event.key === "ArrowDown") move(0, 1);
      if (key === "a" || event.key === "ArrowLeft") move(-1, 0);
      if (key === "d" || event.key === "ArrowRight") move(1, 0);
      if (key === "e") setAction("break");
      if (key === "q") setAction("place");
      if (event.key === "?") setHelpOpen(true);
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const objective = built >= 8 ? "你已经有了一处可以过夜的 shelter。" : night ? "夜晚来了：点亮火把，或继续冒险。" : `在夜晚前搭建避难所（还需要 ${Math.max(0, 8 - built)} 个方块）`;
  const nearby = useMemo(() => [world[player.y]?.[player.x - 1], world[player.y]?.[player.x + 1], world[player.y - 1]?.[player.x], world[player.y + 1]?.[player.x]].filter(Boolean).map((tile) => tile?.type).filter((type) => type !== "grass"), [world, player]);

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">LIVING WORLD / BLOCKWORLD MVP</p><h1>苔原 · 第 {day} 天</h1><span className="subtitle">Rust 世界服务：{serverOnline ? "已连接，世界持续运行" : "未连接，请启动 world-server"}</span></div><div className="view-switch"><button className="help-button" onClick={() => setHelpOpen((value) => !value)}>❔ 新手说明</button><button className={mode === "world" ? "active" : ""} onClick={() => setMode("world")}>生存视角</button><button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}>世界历史</button></div></header>
    {helpOpen && <section className="tutorial" role="dialog" aria-label="新手说明"><div><p className="eyebrow">HOW TO PLAY</p><h2>三分钟了解这个世界</h2></div><button className="tutorial-close" onClick={() => setHelpOpen(false)}>关闭 ×</button><div className="tutorial-steps"><article><b>01</b><strong>先移动</strong><p>用 <kbd>WASD</kbd> 或方向键在方块世界里走动。你只能操作身边一格的方块。</p></article><article><b>02</b><strong>再挖掘</strong><p>保持“挖掘”模式，点击相邻的树、石头或泥土，把材料放进背包。</p></article><article><b>03</b><strong>最后建造</strong><p>选择一种材料，切到“放置”，点击身边的空地。天黑前搭出避难所。</p></article><article><b>❗</b><strong>注意夜晚</strong><p>地图变暗时，怪物会出现。可以点火把、躲进墙后，或先暂停熟悉操作。</p></article></div></section>}
    {mode === "world" ? <section className="game-layout"><aside className="game-sidebar"><div className="status-card"><div className="avatar-player">你</div><h2>流浪者</h2><p>{night ? "❗ 夜晚 · 危险正在靠近" : "☀ 白天 · 适合探索和建造"}</p><div className="hearts">{"♥".repeat(hp)}<i>{"♡".repeat(5 - hp)}</i></div></div><div className="goal-card"><p className="eyebrow">❗ 当前目标</p><strong>{objective}</strong><small>附近：{nearby.length ? nearby.join("、") : "安静的草地"}</small></div><div className="inventory-card"><p className="eyebrow">背包</p>{(Object.keys(blockInfo) as Block[]).map((block) => <button title={`选择${blockInfo[block].label}`} className={`inventory-item ${selected === block ? "selected" : ""}`} key={block} onClick={() => setSelected(block)}><b>{blockInfo[block].icon}</b><span>{blockInfo[block].label}</span><em>{inventory[block]}</em></button>)}</div><div className="controls-card"><p className="eyebrow">操作</p><span><kbd>WASD</kbd> / 方向键移动</span><span><kbd>E</kbd> 挖掘　<kbd>Q</kbd> 放置</span><span>点击相邻方块执行动作</span><button className="mini-help" onClick={() => setHelpOpen(true)}>❔ 再看一遍教学</button><button className="mini-reset" onClick={resetGame}>重新开始这个世界</button></div></aside><section className="world-console"><div className="world-toolbar"><div><span className={`sun-dot ${night ? "moon" : ""}`}></span>{night ? "夜晚" : "白天"} · {String(hour).padStart(2, "0")}:00</div><div className="tool-toggle"><button className={action === "break" ? "active" : ""} onClick={() => setAction("break")}>挖掘</button><button className={action === "place" ? "active" : ""} onClick={() => setAction("place")}>放置 {blockInfo[selected].icon}</button><button disabled={!serverOnline} onClick={() => setServerOnline(false)}>{serverOnline ? "服务端运行中" : "等待服务端"}</button></div></div><div className={`block-world ${night ? "night" : ""}`} aria-label="可以移动和编辑的方块世界">{world.map((row, y) => row.map((tile, x) => { const monster = monsters.some((item) => item.x === x && item.y === y); const isPlayer = player.x === x && player.y === y; return <button key={`${x}-${y}`} className={`block-tile ${tile.type} ${isPlayer ? "player" : ""} ${monster ? "monster" : ""}`} onClick={() => editTile(x, y)} aria-label={`${x},${y} ${tile.type}`}>{isPlayer ? "●" : monster ? "☠" : tileIcon[tile.type]}</button>; }))}</div><div className="world-hint">{serverOnline ? (action === "break" ? "靠近一个资源方块，点击它来挖掘" : `靠近空地，点击放置${blockInfo[selected].label}`) : "等待 Rust world-server 连接后才能操作"} · 当前位置 {player.x},{player.y}</div><div className="log-strip"><div className="log-strip-head"><span>世界事件 · {logs.length}</span><button onClick={() => setShowAllLogs((value) => !value)}>{showAllLogs ? "收起" : "查看更多"}</button></div><div className={showAllLogs ? "log-list expanded" : "log-list"}>{logs.slice(showAllLogs ? -40 : -5).reverse().map((entry, index) => <p className={entry.tone ?? ""} key={`${entry.day}-${index}`}>第{entry.day}天　{entry.text}</p>)}</div></div></section></section> : <section className="history-page"><div className="history-head"><div><p className="eyebrow">WORLD EVENT STREAM</p><h2>这个世界是怎样被改变的</h2></div><span>所有行动都会留下记录</span></div><div className="history-grid"><div className="history-timeline">{logs.map((entry, index) => <article className={entry.tone ?? ""} key={`${entry.day}-${index}`}><span>第 {entry.day} 天</span><p>{entry.text}</p></article>)}</div><aside className="future-card"><p className="eyebrow">未来接口</p><h3>居民与自动化</h3><p>下一层可以让居民读取这条事件流：他们会看到你砍过的树、建过的墙，也会对夜晚留下自己的记忆。</p><p>再往后，玩家可以把重复动作交给可编程代理，逐渐走向 Screeps 的基地与自动化。</p><button onClick={() => setMode("world")}>回到世界</button></aside></div></section>}
  </main>;
}
