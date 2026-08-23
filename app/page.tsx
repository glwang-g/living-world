"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type TileType = "grass" | "tree" | "stone" | "stone-wall" | "water" | "dirt" | "placed-dirt" | "wall" | "torch" | "switch-off" | "switch-on" | "wire" | "door-closed" | "door-open" | "unknown";
type Tile = { type: TileType; discovered?: boolean; visible?: boolean };
type Point = { x: number; y: number };
type Facing = "up" | "down" | "left" | "right";
type LogEntry = { day: number; text: string; tone?: "danger" | "build" | "system" };
type Block = "wood" | "stone" | "dirt" | "torch" | "switch" | "wire" | "door";
type ServerSnapshot = { tick: number; origin_x: number; origin_y: number; width: number; height: number; blocks: TileType[]; player: Point; hp: number; lives: number; inventory: Record<Block, number>; monsters: Point[]; sounds: string[]; night: boolean; sheltered: boolean; torch_lit: boolean };
type ServerEvent = { tick: number; actor: string; kind: string; location: Point | null; text: string };
type ArchiveSummary = { id: string; name: string; day: number };
type HistoryPage = { total: number; offset: number; events: ServerEvent[] };
const HISTORY_PAGE_SIZE = 30;
const toHistoryEntries = (events: ServerEvent[]): LogEntry[] => events.map((event) => ({ day: Math.floor((event.tick - 1) / 24) + 1, text: event.text, tone: event.kind === "night" || event.kind === "spawn" || event.kind === "movement" || event.kind === "damage" || event.kind === "death" || event.kind === "defeat" ? "danger" : event.kind === "building" || event.kind === "mining" || event.kind === "inventory" || event.kind === "reroute" || event.kind === "repelled" ? "build" : "system" }));

const DEFAULT_WORLD_SIZE = 13;
const blockInfo: Record<Block, { label: string; icon: string }> = { wood: { label: "木墙", icon: "🪵" }, stone: { label: "石墙", icon: "⛰️" }, dirt: { label: "泥土", icon: "🟫" }, torch: { label: "火把", icon: "🔥" }, switch: { label: "开关", icon: "◉" }, wire: { label: "导线", icon: "─" }, door: { label: "门", icon: "▣" } };

function makeWorld(): Tile[][] {
  return Array.from({ length: DEFAULT_WORLD_SIZE }, (_, y) => Array.from({ length: DEFAULT_WORLD_SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === DEFAULT_WORLD_SIZE - 1 || y === DEFAULT_WORLD_SIZE - 1) return { type: "water" };
    if ((x * 11 + y * 7) % 23 === 0 || (x === 4 && y > 2 && y < 8)) return { type: "tree" };
    if ((x * 5 + y * 13) % 29 === 0) return { type: "stone" };
    if ((x * 3 + y * 5) % 17 === 0) return { type: "dirt" };
    return { type: "grass" };
  }));
}

const tileIcon: Record<TileType, string> = { grass: "", tree: "🌲", stone: "⛰️", "stone-wall": "🧱", water: "", dirt: "🟫", "placed-dirt": "🟫", wall: "🪵", torch: "🔥", "switch-off": "◉", "switch-on": "●", wire: "─", "door-closed": "▣", "door-open": "□", unknown: "" };
const SAVE_KEY = "living-world:blockworld:v1";
const API_BASE = "/api";
const initialLogs: LogEntry[] = [{ day: 1, text: "你在一片陌生的草地醒来。太阳正在落山，最好在夜晚前搭一面墙。", tone: "system" }];

export default function Home() {
  const [world, setWorld] = useState(makeWorld);
  const [worldOrigin, setWorldOrigin] = useState<Point>({ x: 0, y: 0 });
  const [player, setPlayer] = useState<Point>({ x: 9, y: 6 });
  const [facing, setFacing] = useState<Facing>("down");
  const [walking, setWalking] = useState(false);
  const [hitFlash, setHitFlash] = useState(false);
  const [hp, setHp] = useState(5);
  const [lives, setLives] = useState(3);
  const [inventory, setInventory] = useState<Record<Block, number>>({ wood: 6, stone: 3, dirt: 12, torch: 4, switch: 1, wire: 8, door: 1 });
  const [selected, setSelected] = useState<Block>("wood");
  const [tick, setTick] = useState(1);
  const [mode, setMode] = useState<"world" | "history">("world");
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileHudExpanded, setMobileHudExpanded] = useState(false);
  const [mobileBuildMode, setMobileBuildMode] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [built, setBuilt] = useState(0);
  const [monsters, setMonsters] = useState<Point[]>([]);
  const [sounds, setSounds] = useState<string[]>([]);
  const [sheltered, setSheltered] = useState(false);
  const [torchLit, setTorchLit] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingPath, setPendingPath] = useState<Point[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);
  const [viewColumns, setViewColumns] = useState(13);
  const [viewRows, setViewRows] = useState(13);
  const [coordinatesVisible, setCoordinatesVisible] = useState(false);
  const [hoveredCoordinate, setHoveredCoordinate] = useState<Point | null>(null);
  const [hoveredTile, setHoveredTile] = useState<Point | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [cameraMotion, setCameraMotion] = useState({ key: 0, x: 0, y: 0 });
  const [archiveName, setArchiveName] = useState("");
  const [archiveSaved, setArchiveSaved] = useState(false);
  const [archives, setArchives] = useState<ArchiveSummary[]>([]);
  const [archiveLoadFailed, setArchiveLoadFailed] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>(initialLogs);
  const [historyTitle, setHistoryTitle] = useState("正在运行的世界");
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStart, setHistoryStart] = useState(0);
  const [historyDay, setHistoryDay] = useState("");
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyLoadingPrevious, setHistoryLoadingPrevious] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const cameraOriginRef = useRef<Point | null>(null);
  const pendingPathRef = useRef<Point[]>([]);
  const pendingIntentRef = useRef<{ kind: "mine" | "place"; target: Point } | null>(null);
  const pathPositionRef = useRef<Point>({ x: 9, y: 6 });
  const walkingTimerRef = useRef<number | null>(null);
  const previousHpRef = useRef<number | null>(null);
  const previousLivesRef = useRef<number | null>(null);
  const hitTimerRef = useRef<number | null>(null);
  const historyPageCacheRef = useRef(new Map<string, Promise<HistoryPage>>());
  const historyRequestRef = useRef(0);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyPrependRef = useRef<{ height: number; top: number } | null>(null);
  const exploredRef = useRef(new Map<string, TileType>());
  const worldRef = useRef(world);
  const noticeTimerRef = useRef<number | null>(null);
  const day = Math.floor((tick - 1) / 24) + 1;
  const hour = (tick - 1) % 24;
  const night = hour >= 16 || hour < 5;

  useLayoutEffect(() => {
    const pending = historyPrependRef.current;
    const scroll = historyScrollRef.current;
    if (!pending || !scroll) return;
    scroll.scrollTop = pending.top + scroll.scrollHeight - pending.height;
    historyPrependRef.current = null;
  }, [historyLogs]);

  const applyServerSnapshot = (snapshot: ServerSnapshot) => {
    const serverOrigin = { x: snapshot.origin_x, y: snapshot.origin_y };
    const previousOrigin = cameraOriginRef.current;
    const currentOrigin = previousOrigin ?? serverOrigin;
    const centerX = Math.floor(snapshot.width / 2); const centerY = Math.floor(snapshot.height / 2);
    const playerAt = { x: snapshot.player.x - currentOrigin.x, y: snapshot.player.y - currentOrigin.y };
    const edgeMarginX = Math.max(2, Math.floor(snapshot.width * 0.23)); const edgeMarginY = Math.max(2, Math.floor(snapshot.height * 0.23));
    const resized = snapshot.width !== (worldRef.current[0]?.length ?? 0) || snapshot.height !== worldRef.current.length;
    const shouldPan = resized || playerAt.x < edgeMarginX || playerAt.x > snapshot.width - 1 - edgeMarginX || playerAt.y < edgeMarginY || playerAt.y > snapshot.height - 1 - edgeMarginY;
    const targetOrigin = { x: snapshot.player.x - centerX, y: snapshot.player.y - centerY };
    // The rendered viewport stays in lockstep with the authoritative observation;
    // the previous camera position is used only as the visual animation offset.
    const origin = shouldPan ? targetOrigin : currentOrigin;
    const cameraDelta = { x: origin.x - currentOrigin.x, y: origin.y - currentOrigin.y };
    if (!resized && previousOrigin !== null && (cameraDelta.x !== 0 || cameraDelta.y !== 0)) {
      setCameraMotion((motion) => ({ key: motion.key + 1, x: cameraDelta.x, y: cameraDelta.y }));
    }
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
      if (observed && observed !== "unknown") { exploredRef.current.set(absolute, observed); return { type: observed, discovered: true, visible: true }; }
      const remembered = exploredRef.current.get(absolute);
      if (remembered) return { type: remembered, discovered: true, visible: false };
      return { type: "unknown" as TileType, discovered: false, visible: false };
    }));
    worldRef.current = nextWorld;
    setWorld(nextWorld);
    setWorldOrigin(origin);
    if (previousHpRef.current !== null && (snapshot.hp < previousHpRef.current || snapshot.lives < (previousLivesRef.current ?? snapshot.lives))) {
      setHitFlash(true);
      if (hitTimerRef.current !== null) window.clearTimeout(hitTimerRef.current);
      hitTimerRef.current = window.setTimeout(() => setHitFlash(false), 520);
    }
    previousHpRef.current = snapshot.hp;
    previousLivesRef.current = snapshot.lives;
    setPlayer({ x: snapshot.player.x - origin.x, y: snapshot.player.y - origin.y }); setHp(snapshot.hp); setLives(snapshot.lives); setInventory({ switch: 1, wire: 8, door: 1, ...snapshot.inventory }); setTick(snapshot.tick); setMonsters(snapshot.monsters.map((monster) => ({ x: monster.x - origin.x, y: monster.y - origin.y }))); setSounds(snapshot.sounds); setSheltered(snapshot.sheltered); setTorchLit(snapshot.torch_lit); setServerOnline(true);
  };

  useEffect(() => () => { if (hitTimerRef.current !== null) window.clearTimeout(hitTimerRef.current); }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch(`${API_BASE}/snapshot?columns=${viewColumns}&rows=${viewRows}`, { cache: "no-store" });
        if (!response.ok) throw new Error("world server unavailable");
        const snapshot = await response.json() as ServerSnapshot;
        const eventResponse = await fetch(`${API_BASE}/events`, { cache: "no-store" });
        const events = eventResponse.ok ? await eventResponse.json() as ServerEvent[] : [];
        if (!cancelled) {
          applyServerSnapshot(snapshot);
          if (events.length) setLogs(toHistoryEntries(events).slice(-40));
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
      if (!coordinates) { setHoveredCoordinate(null); setHoveredTile(null); return; }
      const local = { x: Number(coordinates[1]), y: Number(coordinates[2]) };
      setHoveredTile(local);
      setHoveredCoordinate({ x: local.x + (cameraOriginRef.current?.x ?? 0), y: local.y + (cameraOriginRef.current?.y ?? 0) });
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

  const sendCommand = async (payload: Record<string, string | number>): Promise<boolean> => {
    if (!serverOnline) { log("世界服务尚未连接。请先启动 Rust world-server。", "danger"); return false; }
    try {
      const response = await fetch(`${API_BASE}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
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
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ world, player, hp, inventory, selected, tick, built, logs, monsters }));
  }, [hydrated, world, player, hp, inventory, selected, tick, built, logs, monsters]);

  const log = (text: string, tone?: LogEntry["tone"]) => setLogs((current) => [...current, { day, text, tone }].slice(-40));
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2200);
  };
  const dismissTutorialForAction = () => {
    if (!helpOpen) return;
    setHelpOpen(false);
    showNotice("你已经开始行动了，新手教学已自动收起；需要时可随时再打开。");
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
    const freshWorld = makeWorld(); worldRef.current = freshWorld; cameraOriginRef.current = { x: 0, y: 0 }; setWorld(freshWorld); setWorldOrigin({ x: 0, y: 0 }); setPlayer({ x: 9, y: 6 }); setHp(5); setLives(3); setInventory({ wood: 6, stone: 3, dirt: 12, torch: 4, switch: 1, wire: 8, door: 1 }); setSelected("wood"); setTick(6); setBuilt(0); setMonsters([]); setSounds([]); setSheltered(false); setTorchLit(false); setLogs(initialLogs); setArchiveSaved(false); setArchiveName("");
  };
  const saveArchive = async () => {
    if (archiveSaved) return;
    if (!serverOnline) { showNotice("世界服务未连接，暂时无法保存档案。"); return; }
    const name = archiveName.trim() || `第${day}天的防线`;
    try {
      const response = await fetch(`${API_BASE}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error("archive rejected");
      setArchiveSaved(true); setArchiveName(name); void loadArchives(); showNotice(`世界档案「${name}」已保存。可在世界历史底部的档案馆查看。`);
    } catch { showNotice("档案保存失败，请确认世界服务仍在运行。"); }
  };
const loadArchives = async () => { try { const response = await fetch(`${API_BASE}/archives`); if (!response.ok) throw new Error("archives rejected"); setArchives(await response.json() as ArchiveSummary[]); setArchiveLoadFailed(false); } catch { setArchiveLoadFailed(true); } };
  const historyUrl = (archiveId: string | null, offset: number, day?: number) => `${archiveId === null ? `${API_BASE}/events?offset=${offset}&limit=${HISTORY_PAGE_SIZE}` : `${API_BASE}/archive/events?id=${encodeURIComponent(archiveId)}&offset=${offset}&limit=${HISTORY_PAGE_SIZE}`}${day ? `&day=${day}` : ""}`;
  const historyPageKey = (archiveId: string | null, offset: number) => `${archiveId ?? "live"}:${offset}`;
  const requestHistoryPage = (archiveId: string | null, offset: number) => { const key = historyPageKey(archiveId, offset); const cached = historyPageCacheRef.current.get(key); if (cached) return cached; const request = fetch(historyUrl(archiveId, offset)).then(async (response) => { if (!response.ok) throw new Error("history page rejected"); return await response.json() as HistoryPage; }).catch((error) => { historyPageCacheRef.current.delete(key); throw error; }); historyPageCacheRef.current.set(key, request); return request; };
  const prefetchHistoryPage = (archiveId: string | null, offset: number, total: number) => { if (offset < total) void requestHistoryPage(archiveId, offset).catch(() => undefined); };
  const loadHistorySource = async (archiveId: string | null, title: string) => { const requestId = ++historyRequestRef.current; const sourcePrefix = `${archiveId ?? "live"}:`; for (const key of historyPageCacheRef.current.keys()) if (key.startsWith(sourcePrefix)) historyPageCacheRef.current.delete(key); setHistoryRefreshing(true); try { const page = await requestHistoryPage(archiveId, 0); if (requestId !== historyRequestRef.current) return; setHistoryLogs(toHistoryEntries(page.events)); setHistoryTotal(page.total); setHistoryStart(0); setHistoryTitle(title); setSelectedArchiveId(archiveId); setHistoryLoadFailed(false); historyScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); prefetchHistoryPage(archiveId, page.events.length, page.total); } catch { if (requestId === historyRequestRef.current) setHistoryLoadFailed(true); } finally { if (requestId === historyRequestRef.current) setHistoryRefreshing(false); } };
  const loadLiveHistory = async () => { await loadHistorySource(null, "正在运行的世界"); };
  const openArchiveHistory = async (archive: ArchiveSummary) => { await loadHistorySource(archive.id, `档案 · ${archive.name}`); };
  const loadMoreHistory = async () => { if (historyLoadingMore || historyStart + historyLogs.length >= historyTotal) return; const source = selectedArchiveId; const requestId = historyRequestRef.current; const offset = historyStart + historyLogs.length; setHistoryLoadingMore(true); try { const page = await requestHistoryPage(source, offset); if (requestId !== historyRequestRef.current) return; setHistoryLogs((current) => [...current, ...toHistoryEntries(page.events)]); setHistoryTotal(page.total); prefetchHistoryPage(source, offset + page.events.length, page.total); } catch { if (requestId === historyRequestRef.current) setHistoryLoadFailed(true); } finally { if (requestId === historyRequestRef.current) setHistoryLoadingMore(false); } };
  const loadPreviousHistory = async () => { if (historyLoadingPrevious || historyStart === 0) return; const source = selectedArchiveId; const requestId = historyRequestRef.current; const offset = Math.max(0, historyStart - HISTORY_PAGE_SIZE); const scroll = historyScrollRef.current; if (scroll) historyPrependRef.current = { height: scroll.scrollHeight, top: scroll.scrollTop }; setHistoryLoadingPrevious(true); try { const page = await requestHistoryPage(source, offset); if (requestId !== historyRequestRef.current) { historyPrependRef.current = null; return; } setHistoryLogs((current) => [...toHistoryEntries(page.events), ...current]); setHistoryStart(offset); setHistoryTotal(page.total); prefetchHistoryPage(source, Math.max(0, offset - HISTORY_PAGE_SIZE), page.total); } catch { historyPrependRef.current = null; if (requestId === historyRequestRef.current) setHistoryLoadFailed(true); } finally { if (requestId === historyRequestRef.current) setHistoryLoadingPrevious(false); } };
  const jumpToLatestHistory = async () => { if (!historyTotal) return; const source = selectedArchiveId; const requestId = ++historyRequestRef.current; const offset = Math.floor((historyTotal - 1) / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE; setHistoryRefreshing(true); try { const page = await requestHistoryPage(source, offset); if (requestId !== historyRequestRef.current) return; setHistoryLogs(toHistoryEntries(page.events)); setHistoryStart(offset); setHistoryTotal(page.total); setHistoryLoadFailed(false); historyScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); prefetchHistoryPage(source, Math.max(0, offset - HISTORY_PAGE_SIZE), page.total); } catch { if (requestId === historyRequestRef.current) setHistoryLoadFailed(true); } finally { if (requestId === historyRequestRef.current) setHistoryRefreshing(false); } };
  const jumpToHistoryDay = async () => { const day = Number(historyDay); if (!Number.isInteger(day) || day < 1) { showNotice("请输入有效的第 N 天。 "); return; } const source = selectedArchiveId; const requestId = ++historyRequestRef.current; setHistoryRefreshing(true); try { const response = await fetch(historyUrl(source, 0, day)); if (!response.ok) throw new Error("day jump rejected"); const page = await response.json() as HistoryPage; if (requestId !== historyRequestRef.current) return; setHistoryLogs(toHistoryEntries(page.events)); setHistoryStart(page.offset); setHistoryTotal(page.total); setHistoryLoadFailed(false); historyScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); prefetchHistoryPage(source, Math.max(0, page.offset - HISTORY_PAGE_SIZE), page.total); prefetchHistoryPage(source, page.offset + page.events.length, page.total); } catch { if (requestId === historyRequestRef.current) { setHistoryLoadFailed(true); showNotice("无法跳转到这一天，请确认世界服务已更新。"); } } finally { if (requestId === historyRequestRef.current) setHistoryRefreshing(false); } };
  const deleteArchive = async (archive: ArchiveSummary) => { if (!window.confirm(`彻底删除世界档案「${archive.name}」？此操作不可恢复。`)) return; try { const response = await fetch(`${API_BASE}/archive/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: archive.id }) }); if (!response.ok) throw new Error(); setArchives((current) => current.filter((item) => item.id !== archive.id)); if (selectedArchiveId === archive.id) void loadLiveHistory(); showNotice(`已彻底删除「${archive.name}」。`); } catch { showNotice("删除失败，请确认世界服务仍在运行。"); } };
  const canReach = (x: number, y: number) => Math.abs(x - player.x) + Math.abs(y - player.y) === 1;
  const facingFromDelta = (dx: number, dy: number): Facing => Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
  const animateWalk = () => {
    setWalking(true);
    if (walkingTimerRef.current !== null) window.clearTimeout(walkingTimerRef.current);
    walkingTimerRef.current = window.setTimeout(() => setWalking(false), 390);
  };

  const move = (dx: number, dy: number) => {
    if (lives === 0) { showNotice("这次冒险已经结束。请重新开始，或回看世界历史。"); return; }
    const x = player.x + dx; const y = player.y + dy; const tile = world[y]?.[x];
    if (dx !== 0 || dy !== 0) { setFacing(facingFromDelta(dx, dy)); animateWalk(); }
    if (tile && !["grass", "torch"].includes(tile.type)) {
      const label = tile.type === "wall" ? "木墙" : tile.type === "stone-wall" ? "石墙" : tile.type === "tree" ? "树木" : tile.type === "stone" ? "石头" : tile.type === "dirt" ? "天然泥土" : tile.type === "placed-dirt" ? "泥土块" : "水面";
      showNotice(`${label}挡住了去路，先挖开它。`); return;
    }
    dismissTutorialForAction();
    if (serverOnline) {
      const direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
      void sendCommand({ command: "move", direction });
      return;
    }
    if (!tile) { showNotice("那里还没有被探索。先沿着已知区域前进。"); return; }
    setPlayer({ x, y });
    if (monsters.some((monster) => monster.x === x && monster.y === y)) { setHp((value) => Math.max(0, value - 1)); log("黑暗里的东西撞上了你，你受了伤。", "danger"); }
  };

  const isWalkable = (tile?: Tile) => Boolean(tile && ["grass", "torch", "door-open"].includes(tile.type));
  const isMineable = (tile?: Tile) => Boolean(tile && ["tree", "stone", "dirt", "torch"].includes(tile.type));
  const isPlaceable = (tile?: Tile) => Boolean(tile && tile.type === "grass");
  const findPath = (target: Point) => {
    const queue: Point[] = [player];
    const cameFrom = new Map<string, Point | null>([[`${player.x},${player.y}`, null]]);
    while (queue.length) {
      const current = queue.shift()!;
      if (current.x === target.x && current.y === target.y) {
        const path: Point[] = [];
        let cursor: Point | null = current;
        while (cursor && !(cursor.x === player.x && cursor.y === player.y)) { path.unshift(cursor); cursor = cameFrom.get(`${cursor.x},${cursor.y}`) ?? null; }
        return path;
      }
      for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
        const key = `${next.x},${next.y}`;
        if (!cameFrom.has(key) && isWalkable(world[next.y]?.[next.x])) { cameFrom.set(key, current); queue.push(next); }
      }
    }
    return null;
  };

  type PathIntent = "move" | "mine" | "place";
  const startPathTo = (x: number, y: number, intent: PathIntent) => {
    const tile = world[y]?.[x];
    if (!tile || tile.type === "unknown") { showNotice("那里还没有被探索。先沿着已知区域前进。"); return; }
    let path: Point[] | null = null;
    if (intent === "mine" || intent === "place" || !isWalkable(tile)) {
      const candidates = [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }].filter((point) => isWalkable(world[point.y]?.[point.x]));
      path = candidates.map((point) => findPath(point)).filter((candidate): candidate is Point[] => candidate !== null).sort((a, b) => a.length - b.length)[0] ?? null;
    } else if (isWalkable(tile)) path = findPath({ x, y });
    if (!path) { showNotice("这条路走不通，先改变周围的地形。"); return; }
    if (path[0]) setFacing(facingFromDelta(path[0].x - player.x, path[0].y - player.y));
    pathPositionRef.current = { ...player };
    pendingIntentRef.current = intent === "mine" || intent === "place" ? { kind: intent, target: { x, y } } : null;
    pendingPathRef.current = path;
    setPendingPath(path);
    showNotice(`正在前往 (${x},${y})`);
  };

  const executeMine = (x: number, y: number) => {
    if (serverOnline) { void sendCommand({ command: "break", x: x + worldOrigin.x, y: y + worldOrigin.y }); return; }
    const tile = world[y]?.[x];
    if (!tile || !isMineable(tile)) { showNotice("这块地方没有可以挖掘的材料。看起来它已经被改变了。"); return; }
    const gain: Partial<Record<Block, number>> = tile.type === "tree" ? { wood: 2 } : tile.type === "stone" || tile.type === "stone-wall" ? { stone: 1 } : tile.type === "dirt" || tile.type === "placed-dirt" ? { dirt: 2 } : tile.type === "torch" ? { torch: 1 } : {};
    setInventory((current) => ({ ...current, ...Object.fromEntries(Object.entries(gain).map(([key, value]) => [key, current[key as Block] + (value ?? 0)])) }));
    setWorld((current) => { const next = current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type: "grass" as TileType } : item)); worldRef.current = next; return next; });
    log(`你挖掉了${tile.type === "tree" ? "一棵树" : tile.type === "stone" ? "一块石头" : tile.type === "stone-wall" ? "一面石墙" : tile.type === "wall" ? "一面木墙" : tile.type === "dirt" ? "一块天然泥土" : tile.type === "placed-dirt" ? "一块泥土块" : "一块方块"}，材料掉落在脚边。`, "build");
  };

  const executePlace = (x: number, y: number) => {
    if (serverOnline) { void sendCommand({ command: "place", block: selected, x: x + worldOrigin.x, y: y + worldOrigin.y }); return; }
    const tile = world[y]?.[x];
    if (inventory[selected] <= 0) { showNotice(`你的${blockInfo[selected].label}用完了。`); return; }
    if (!isPlaceable(tile)) { showNotice("这里只能在空草地上放置方块。"); return; }
    const type: TileType = selected === "wood" ? "wall" : selected === "stone" ? "stone-wall" : selected === "dirt" ? "placed-dirt" : selected;
    setWorld((current) => { const next = current.map((row, rowIndex) => row.map((item, columnIndex) => rowIndex === y && columnIndex === x ? { type } : item)); worldRef.current = next; return next; });
    setInventory((current) => ({ ...current, [selected]: current[selected] - 1 }));
    setBuilt((value) => value + 1);
    log(`你放置了${blockInfo[selected].label}。一个可以躲避夜晚的地方正在成形。`, "build");
  };

  useEffect(() => {
    if (!pendingPath.length) return;
    const timer = window.setTimeout(async () => {
      const [next, ...rest] = pendingPath;
      setPendingPath(rest);
      pendingPathRef.current = rest;
      const from = pathPositionRef.current;
      const dx = next.x - from.x; const dy = next.y - from.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) { setPendingPath([]); pendingPathRef.current = []; return; }
      setFacing(facingFromDelta(dx, dy));
      animateWalk();
      if (serverOnline) {
        const direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
        if (!(await sendCommand({ command: "move", direction }))) { setPendingPath([]); pendingPathRef.current = []; return; }
      } else move(dx, dy);
      pathPositionRef.current = next;
      if (rest.length === 0) {
        const intent = pendingIntentRef.current;
        pendingIntentRef.current = null;
        if (intent?.kind === "mine") executeMine(intent.target.x, intent.target.y);
        if (intent?.kind === "place") executePlace(intent.target.x, intent.target.y);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  // These world actions intentionally keep the current snapshot; adding them as dependencies would restart the step timer on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPath, player, serverOnline]);

  const editTile = (x: number, y: number, shiftHeld = false) => {
    if (lives === 0) { showNotice("这次冒险已经结束。请重新开始，或回看世界历史。"); return; }
    const tile = world[y]?.[x];
    if (!tile || tile.type === "unknown") { showNotice("那里还没有被探索。先沿着已知区域前进。"); return; }
    dismissTutorialForAction();
    if (tile.type === "switch-off" || tile.type === "switch-on") { if (canReach(x, y)) { void sendCommand({ command: "toggle", x: x + worldOrigin.x, y: y + worldOrigin.y }); } else startPathTo(x, y, "move"); return; }
    if (shiftHeld && isPlaceable(tile)) {
      if (canReach(x, y)) executePlace(x, y); else startPathTo(x, y, "place");
      return;
    }
    if (isMineable(tile)) { if (canReach(x, y)) executeMine(x, y); else startPathTo(x, y, "mine"); return; }
    if (isWalkable(tile)) { if (canReach(x, y)) move(x - player.x, y - player.y); else startPathTo(x, y, "move"); return; }
    startPathTo(x, y, "move");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") { setShiftHeld(true); return; }
      const key = event.key.toLowerCase();
      if (key === "w" || event.key === "ArrowUp") { event.preventDefault(); move(0, -1); }
      if (key === "s" || event.key === "ArrowDown") { event.preventDefault(); move(0, 1); }
      if (key === "a" || event.key === "ArrowLeft") { event.preventDefault(); move(-1, 0); }
      if (key === "d" || event.key === "ArrowRight") { event.preventDefault(); move(1, 0); }
      if (key === "c") setCoordinatesVisible((value) => !value);
      if (event.key === "?") setHelpOpen(true);
      if (event.key === "Escape") setHelpOpen(false);
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === "Shift") setShiftHeld(false); };
    const onWindowBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onWindowBlur); };
  });

  useEffect(() => {
    if (!helpOpen) return;
    scrollToTop();
  }, [helpOpen]);

  useEffect(() => {
    if (lives !== 0 || archiveName) return;
    setArchiveName(sheltered ? `封闭防线 · 第${day}天` : torchLit ? `火把与窄口 · 第${day}天` : built ? `未完成的防线 · 第${day}天` : `黑暗中的第一夜 · 第${day}天`);
  }, [archiveName, built, day, lives, sheltered, torchLit]);

  const baseObjective = sheltered ? "你的墙封住了入口：可以在里面观察怪物如何寻找路径。" : torchLit ? "火把已建立安全半径；再用墙把怪物的路线压缩到一个入口。" : night ? "夜晚来了：火把会驱离怪物，墙会迫使它绕行。" : `在夜晚前试着做出一条防线（还需要 ${Math.max(0, 8 - built)} 个方块）`;
  const objective = sounds.length ? `${baseObjective} ${sounds.join(" ")}` : baseObjective;
  const defenseReadout = !night ? "白天：采集材料，观察地形，为夜晚准备一条可控入口。" : sheltered ? "防线闭合：怪物无法找到进入路线。" : torchLit ? "火光生效：附近怪物会撤退，墙能改变它的绕行路线。" : monsters.length ? "威胁可见：怪物正按可通行格寻路接近。" : "夜晚：注意黑暗中传来的脚步声。";
  const nearby = useMemo(() => [world[player.y]?.[player.x - 1], world[player.y]?.[player.x + 1], world[player.y - 1]?.[player.x], world[player.y + 1]?.[player.x]].filter(Boolean).map((tile) => tile?.type).filter((type) => type !== "grass" && type !== "unknown"), [world, player.x, player.y]);
  const previewTile = hoveredTile ? world[hoveredTile.y]?.[hoveredTile.x] : undefined;
  const placementPreview = Boolean(shiftHeld && hoveredTile && isPlaceable(previewTile));
  const placementPlan = hoveredTile && canReach(hoveredTile.x, hoveredTile.y) ? "从当前位置放置" : "将走到相邻格后放置";
  const gameOver = lives === 0;
  const finalEvents = logs.filter((entry) => entry.tone === "danger" || entry.tone === "build").slice(-3).reverse();

  const facingLabel: Record<Facing, string> = { up: "上", down: "下", left: "左", right: "右" };

  return <main className="app-shell" onClickCapture={(event) => { const target = event.target as HTMLElement; const helpButton = target.closest(".help-button"); const miniHelp = target.closest(".mini-help"); if (miniHelp || helpButton) { scrollToTop(); replayTutorialPulse(); } }}>
    <header className="topbar"><div><p className="eyebrow">LIVING WORLD / BLOCKWORLD MVP</p><h1>苔原 · 第 {day} 天</h1><span className="subtitle">Rust 世界服务：{serverOnline ? "已连接，世界持续运行" : "未连接，请启动 world-server"}</span></div><div className="view-switch"><button className={`help-button ${helpOpen ? "active" : ""}`} aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}>❔ 新手说明</button><button className={mode === "world" ? "active" : ""} onClick={() => setMode("world")}>生存视角</button><button className={mode === "history" ? "active" : ""} onClick={() => { setMode("history"); void loadArchives(); void loadLiveHistory(); }}>世界历史</button></div></header>
    {helpOpen && <section className="tutorial" role="dialog" aria-label="新手说明"><div><p className="eyebrow">HOW TO PLAY</p><h2>三分钟了解这个世界</h2><small>开始一次有效行动后会自动收起；随时可以再打开。</small></div><button className="tutorial-close" onClick={() => setHelpOpen(false)}>关闭 ×</button><div className="tutorial-steps"><article><b>01</b><strong>先移动</strong><p>用 <kbd>WASD</kbd> 或方向键移动，也可以点击视野内的空草地自动寻路。</p></article><article><b>02</b><strong>点击即行动</strong><p>点击资源会走到旁边并自动挖掘；点击障碍物会尝试走到它旁边。</p></article><article><b>03</b><strong>按住建造</strong><p>按住 <kbd>Shift</kbd> 悬停空草地可预览选中方块，点击后会移动并放置。非空格仍只会接近目标。</p></article><article><b>❗</b><strong>用火把过夜</strong><p>把火把放在避难所内部、入口和道路旁。火把照亮周围并保护居民，但不是武器；夜里仍要留意墙外的脚步声。</p></article></div></section>}
    {mode === "world" ? <section className="game-layout">
      <aside className="game-sidebar">
        <section className="world-summary-card">
          <div className="status-card"><div className={"avatar-player facing-" + facing} aria-label={"角色朝向" + facingLabel[facing]}></div><h2>流浪者</h2><p>{night ? "❗ 夜晚 · 危险正在靠近" : "☀ 白天 · 适合探索和建造"}</p><div className="life-count" aria-label={"剩余 " + lives + " 条命"}>命数　{"●".repeat(lives)}<i>{"○".repeat(3 - lives)}</i></div><div className={"health-meter " + (hitFlash ? "hit" : "")} role="progressbar" aria-label="当前生命血量" aria-valuemin={0} aria-valuemax={5} aria-valuenow={hp}><span style={{ width: (hp * 20) + "%" }}></span></div><small className="health-label">血量 {hp} / 5</small></div>
          <div className="goal-card"><p className="eyebrow">❗ 当前目标</p><strong>{objective}</strong><small>附近：{nearby.length ? nearby.join("、") : "安静的草地"}</small></div>
          <div className={"defense-card " + (night ? "night" : "day")}><p className="eyebrow">防线读数</p><strong>{night ? (sheltered ? "封闭避难所" : torchLit ? "火光防线" : "入口暴露") : "准备阶段"}</strong><p>{defenseReadout}</p><small>规则：怪物只能走草地或火把格；墙体会改变它的路线。</small></div>
        </section>
        <div className="inventory-card"><p className="eyebrow">背包</p>{(Object.keys(blockInfo) as Block[]).map((block) => <button title={"选择" + blockInfo[block].label} className={"inventory-item " + (selected === block ? "selected" : "")} key={block} onClick={() => setSelected(block)}><b>{blockInfo[block].icon}</b><span>{blockInfo[block].label}</span><em>{inventory[block]}</em></button>)}</div>
        <div className="controls-card"><p className="eyebrow">操作与反馈</p><span><kbd>WASD</kbd> / 方向键移动</span><span>点击资源挖掘，点击空草地移动</span><span><kbd>Shift</kbd> + 悬停空草地：预览并放置选中方块</span><button className="mini-help" onClick={() => setHelpOpen(true)}>❔ 再看一遍教学</button><button className="mini-reset" onClick={resetGame}>重新开始这个世界</button><div className="log-strip control-log-strip"><div className="log-strip-head"><span>近期世界事件 · {logs.length}</span><button onClick={() => setShowAllLogs((value) => !value)}>{showAllLogs ? "收起" : "查看更多"}</button></div><div className={showAllLogs ? "log-list expanded" : "log-list"}>{logs.slice(showAllLogs ? -40 : -5).reverse().map((entry, index) => <p className={entry.tone ?? ""} key={entry.day + "-" + index}>第{entry.day}天　{entry.text}</p>)}</div></div></div>
      </aside>
      <section className="world-console">
        <div className="world-toolbar"><div><span className={"sun-dot " + (night ? "moon" : "")}></span>{night ? "夜晚" : "白天"} · {String(hour).padStart(2, "0")}:00</div><div className={"server-status " + (serverOnline ? "online" : "offline")} aria-label={serverOnline ? "世界服务已连接" : "世界服务未连接"}><span></span>{serverOnline ? "世界持续运行" : "等待世界服务"}</div></div>
        {notice && <div className="world-notice" role="status">⚠ {notice}</div>}
        {gameOver && <section className="game-over" role="dialog" aria-modal="true" aria-labelledby="game-over-title"><p className="eyebrow">WORLD ENDED · 第 {day} 天</p><h2 id="game-over-title">这一次冒险结束了</h2><p>三条生命都耗尽了。给这个世界留一个名字，重开后它仍会作为档案被保留。</p><label className="archive-name"><span>世界档案名称</span><input value={archiveName} maxLength={40} onChange={(event) => setArchiveName(event.target.value)} placeholder="例如：火把与窄口" disabled={archiveSaved} /></label><div className="final-events"><strong>最后的世界事件</strong>{finalEvents.length ? finalEvents.map((entry, index) => <span key={entry.text + index}>第{entry.day}天　{entry.text}</span>) : <span>黑暗吞没了最后一处可见的草地。</span>}</div><div className="game-over-actions"><button className="save-archive" onClick={saveArchive} disabled={archiveSaved}>{archiveSaved ? "档案已保存" : "保存世界档案"}</button><button className="restart-world" onClick={resetGame}>重新开始</button><button className="review-history" onClick={() => { setMode("history"); void loadArchives(); void loadLiveHistory(); }}>查看世界历史</button></div></section>}
        <div className="world-viewport" aria-label="可以移动和编辑的方块世界">
        <section className={"mobile-world-hud " + (mobileHudExpanded ? "expanded" : "")} aria-label="角色与世界状态">
          <button className="mobile-world-hud-toggle" aria-expanded={mobileHudExpanded} onClick={() => setMobileHudExpanded((value) => !value)}>
            <span className={"mobile-hud-avatar facing-" + facing} aria-hidden="true"></span>
            <span className="mobile-hud-title"><strong>流浪者</strong><small>{night ? "夜晚 · 小心墙外" : "白天 · 正在探索"}</small></span>
            <span className="mobile-hud-vitals">♥ {hp}/5</span><span className="mobile-hud-chevron">⌄</span>
          </button>
          <div className="mobile-world-hud-details">
            <div><p className="eyebrow">当前目标</p><strong>{objective}</strong><small>附近：{nearby.length ? nearby.join("、") : "安静的草地"}</small></div>
            <div className={"mobile-defense " + (night ? "night" : "")}><p className="eyebrow">防线</p><strong>{night ? (sheltered ? "封闭避难所" : torchLit ? "火光防线" : "入口暴露") : "准备阶段"}</strong><small>{defenseReadout}</small></div>
            <div className="mobile-hud-actions"><button className="mini-help" onClick={() => setHelpOpen(true)}>❔ 教学</button><button className="mini-reset" onClick={resetGame}>重新开始</button></div>
            <div className="log-strip mobile-hud-log"><div className="log-strip-head"><span>近期事件</span><button onClick={() => setShowAllLogs((value) => !value)}>{showAllLogs ? "收起" : "更多"}</button></div><div className={showAllLogs ? "log-list expanded" : "log-list"}>{logs.slice(showAllLogs ? -40 : -3).reverse().map((entry, index) => <p className={entry.tone ?? ""} key={entry.day + "-mobile-" + index}>第{entry.day}天　{entry.text}</p>)}</div></div>
          </div>
        </section>
        <div className={"mobile-resource-dock " + (mobileBuildMode ? "placing" : "")} aria-label="当前资源">{(Object.keys(blockInfo) as Block[]).map((block) => <button key={block} aria-pressed={selected === block && mobileBuildMode} aria-label={(selected === block && mobileBuildMode ? "退出放置模式，当前材料" : "选择并放置") + blockInfo[block].label + "，剩余 " + inventory[block]} className={selected === block ? "selected" : ""} onClick={() => { setSelected(block); setMobileBuildMode((current) => selected === block ? !current : true); }}><b>{blockInfo[block].icon}</b><em>{inventory[block]}</em></button>)}</div>
        <div key={cameraMotion.key} className={"block-world " + (night ? "night " : "") + (cameraMotion.x || cameraMotion.y ? "camera-panning" : "")} style={{ "--camera-shift-x": (cameraMotion.x * 100 / (world[0]?.length ?? 1)) + "%", "--camera-shift-y": (cameraMotion.y * 100 / (world.length || 1)) + "%" } as CSSProperties}>
          {world.map((row, y) => row.map((tile, x) => { const monster = monsters.some((item) => item.x === x && item.y === y); return <button key={x + "-" + y} className={"block-tile " + tile.type + " " + (monster ? "monster" : "") + " " + (tile.discovered && tile.visible === false ? "remembered" : "")} onClick={(event) => editTile(x, y, event.shiftKey || mobileBuildMode)} aria-label={x + "," + y + " " + tile.type}>{monster ? "☠" : tileIcon[tile.type]}</button>; }))}
          {placementPreview && hoveredTile && <div className="placement-preview" role="status" style={{ left: ((hoveredTile.x + 0.5) * 100 / (world[0]?.length ?? 1)) + "%", top: ((hoveredTile.y + 0.5) * 100 / (world.length || 1)) + "%" }}><span className="placement-ghost">{blockInfo[selected].icon}</span><div><strong>放置：{blockInfo[selected].label}</strong><small>{inventory[selected] > 0 ? placementPlan : "材料不足，无法放置"}</small></div></div>}
          <div className={"player-actor facing-" + facing + " " + (walking ? "walking" : "")} aria-label={"角色朝向" + facingLabel[facing]} style={{ left: ((player.x + 0.5) * 100 / (world[0]?.length ?? 1)) + "%", top: ((player.y + 0.5) * 100 / (world.length || 1)) + "%", width: (100 / (world[0]?.length ?? 1)) + "%", height: (100 / (world.length || 1)) + "%" }} />
          <div className={"damage-flash " + (hitFlash ? "active" : "")} aria-hidden="true"><span>✦</span></div>
        </div>
        </div>
        <div className="world-hint">{serverOnline ? "点资源挖掘；点空草地移动；按住 Shift 悬停空草地可预览放置" : "等待 Rust world-server 连接后才能操作"} · 当前位置 {player.x},{player.y}</div>
      </section>
    </section> : <section className="history-page"><div className="history-head"><div><p className="eyebrow">WORLD EVENT STREAM</p><h2>{historyTitle}</h2></div><div className="history-actions"><span>{historyRefreshing ? "正在平滑切换历史…" : `第 ${historyLogs.length ? historyStart + 1 : 0}—${historyStart + historyLogs.length} / ${historyTotal} 条`}</span><button onClick={() => void loadHistorySource(selectedArchiveId, historyTitle)}>最早</button><button onClick={() => void jumpToLatestHistory()}>最新</button><label className="history-day-jump"><span>第</span><input aria-label="跳转到第几天" inputMode="numeric" min="1" type="number" value={historyDay} onChange={(event) => setHistoryDay(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void jumpToHistoryDay(); }} /><span>天</span></label><button onClick={() => void jumpToHistoryDay()}>跳转</button></div></div><div className="history-grid"><div className="history-scroll" ref={historyScrollRef} onScroll={(event) => { const node = event.currentTarget; if (node.scrollTop <= 72) void loadPreviousHistory(); else if (node.scrollTop + node.clientHeight >= node.scrollHeight - 72) void loadMoreHistory(); }}><div className="history-timeline">{historyStart > 0 && <p className="history-more history-before">{historyLoadingPrevious ? "正在加载更早的历史…" : "继续向上滚动，加载更早的历史"}</p>}{historyLoadFailed ? <p className="history-empty">无法读取事件历史，请确认世界服务已更新。</p> : historyLogs.length ? historyLogs.map((entry, index) => <article className={entry.tone ?? ""} key={entry.day + "-" + index}><span>第 {entry.day} 天</span><p>{entry.text}</p></article>) : <p className="history-empty">这份世界还没有留下事件记录。</p>}{historyStart + historyLogs.length < historyTotal && <p className="history-more">{historyLoadingMore ? "正在加载下一段历史…" : "继续向下滚动，加载下一段历史"}</p>}</div></div><aside className="history-side"><section className="archive-library" aria-label="世界档案馆"><div className="archive-library-head"><div><p className="eyebrow">SAVED WORLDS</p><h2>世界档案馆</h2><p>选择一份档案，左侧会切换为它自己的滚动事件流。</p></div><button className="archive-refresh" onClick={() => void loadArchives()}>刷新档案</button></div><button className={`archive-current ${selectedArchiveId === null ? "active" : ""}`} onClick={() => void loadLiveHistory()}>查看正在运行的世界</button>{archiveLoadFailed ? <p className="archive-empty">暂时无法连接世界档案服务。请确认世界服务已启动并更新到当前版本后，再刷新档案。</p> : archives.length ? <div className="archive-list">{archives.map((archive) => <article className={selectedArchiveId === archive.id ? "selected" : ""} key={archive.id}><button className="archive-open" onClick={() => void openArchiveHistory(archive)}><strong>{archive.name}</strong><span>第 {archive.day} 天保存 · 打开滚动历史</span></button><button className="archive-delete" onClick={() => void deleteArchive(archive)}>删除</button></article>)}</div> : <p className="archive-empty">还没有已保存的世界。冒险结束时，为它命名并点击“保存世界档案”，它就会出现在这里。</p>}</section><section className="future-card"><p className="eyebrow">未来接口</p><h3>居民与自动化</h3><p>下一层可以让居民读取这条事件流：他们会看到你砍过的树、建过的墙，也会对夜晚留下自己的记忆。</p><p>再往后，玩家可以把重复动作交给可编程代理，逐渐走向 Screeps 的基地与自动化。</p><button onClick={() => setMode("world")}>回到世界</button></section></aside></div></section>}
  </main>;
}
