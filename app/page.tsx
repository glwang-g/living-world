"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Agent = {
  id: number; name: string; role: string; color: string; x: number; y: number;
  hunger: number; energy: number; social: number; bond: number; status: string;
  trait: string; skill: "采集" | "建造" | "社交" | "照料";
};

type WorldEvent = { title: string; body: string; choices: [string, string, string] };

const names = ["阿岚", "小满", "石头", "月芽", "拓海", "知夏", "麦冬", "云雀"];
const colors = ["#fa9c55", "#75c5b9", "#b88cde", "#f5d36c", "#7ea8f8", "#e6849e", "#91bf68", "#eab274"];
const roles = ["采集者", "农夫", "建造者", "搬运工", "厨师", "观察者", "工匠", "探路者"];
const traits = ["热心但冲动", "安静而敏锐", "务实可靠", "喜欢冒险", "照顾每个人", "观察细节", "不服输", "乐于分享"];
const skills: Agent["skill"][] = ["采集", "照料", "建造", "采集", "照料", "社交", "建造", "社交"];

const initialAgents: Agent[] = names.map((name, id) => ({
  id, name, role: roles[id], color: colors[id], x: 2 + (id % 4) * 3, y: 2 + Math.floor(id / 4) * 4,
  hunger: 56 + (id * 7) % 24, energy: 52 + (id * 11) % 32, social: 44 + (id * 13) % 36,
  bond: 28 + (id * 9) % 40, status: "正在观察世界", trait: traits[id], skill: skills[id],
}));

const terrain = Array.from({ length: 176 }, (_, i) => {
  const x = i % 16; const y = Math.floor(i / 16);
  if ((x === 0 && y < 7) || (x === 15 && y > 6) || (x === 1 && y === 0)) return "water";
  if ((x * 7 + y * 11) % 19 === 0) return "forest";
  if ((x * 5 + y * 3) % 37 === 0) return "ore";
  if (x > 5 && x < 10 && y > 3 && y < 7) return "village";
  return "grass";
});

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }

export default function Home() {
  const [running, setRunning] = useState(true); const [speed, setSpeed] = useState(1); const [tick, setTick] = useState(1);
  const [food, setFood] = useState(96); const [wood, setWood] = useState(42); const [morale, setMorale] = useState(68);
  const [drought, setDrought] = useState(false); const [kitchenLevel, setKitchenLevel] = useState(0);
  const [agents, setAgents] = useState(initialAgents); const [pendingEvent, setPendingEvent] = useState<WorldEvent | null>(null);
  const [events, setEvents] = useState<string[]>(["居民们在晨光中开始了第一个循环。", "阿岚和小满因一次帮忙建立了信任。", "工坊储备了足够木材，聚落正在形成。"]);
  const eventTick = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setTick((current) => current + 1);
      setAgents((current) => current.map((agent, index) => {
        const need = Math.min(agent.hunger, agent.energy, agent.social); let status = "正在探索";
        let x = agent.x; let y = agent.y; let hunger = agent.hunger - (drought ? 3 : 1); let energy = agent.energy - 1;
        let social = agent.social - 1; let bond = agent.bond;
        if (need === agent.hunger) { status = food > 8 ? "正在吃饭" : "正在寻找食物"; hunger += food > 8 ? 11 + kitchenLevel * 2 : 2; if (index % 3 === 0) setFood((value) => Math.max(0, value - 2)); }
        else if (need === agent.energy) { status = "正在休息"; energy += 9; }
        else if (need === agent.social) { status = "正在聊天"; social += 10; bond += agent.skill === "社交" ? 3 : 2; }
        else { status = agent.skill === "建造" ? "正在建造" : agent.skill === "照料" ? "正在照料田地" : "正在采集"; x = clamp(x + ((index + tick) % 3 - 1)); y = clamp(y + ((index * 2 + tick) % 3 - 1)); if (index % 3 === 0) setFood((value) => clamp(value + (drought ? 0 : 2 + kitchenLevel))); if (index % 4 === 0) setWood((value) => clamp(value + (agent.skill === "建造" ? 2 : 1))); }
        return { ...agent, x: Math.min(15, x), y: Math.min(10, y), hunger: clamp(hunger), energy: clamp(energy), social: clamp(social), bond: clamp(bond), status };
      }));
      setMorale((value) => clamp(value + (drought ? -1 : 0)));
    }, Math.max(250, 1250 / speed));
    return () => window.clearInterval(id);
  }, [running, speed, drought, food, tick, kitchenLevel]);

  useEffect(() => {
    if (tick > 1 && tick % 8 === 0) {
      const story = drought ? "旱灾持续，居民开始把水井视为共同的希望。" : ["月芽在树林里发现了一片新的莓果。", "两位居民在工作间隙分享了晚餐。", "工坊完成了一件改善生活的小工具。", "孩子们把一处空地变成了游戏场。"][tick / 8 % 4];
      setEvents((current) => [story, ...current].slice(0, 5));
    }
    if (tick > 1 && tick % 10 === 0 && eventTick.current !== tick) {
      eventTick.current = tick;
      setPendingEvent(drought
        ? { title: "井水见底", body: "旱季比预想更久。居民们看着干裂的水井，等待你的决定。", choices: ["严格配给 · -8 食物", "用木材修井 · -10 木材", "装作没事 · -6 士气"] }
        : { title: "迷路的旅人", body: "一位旅人带着地图来到聚落。他很饿，但也许能带来新的知识。", choices: ["分享食物 · -10 食物", "请他帮忙 · +10 木材", "请他离开 · -6 士气"] });
    }
  }, [tick, drought]);

  const averageNeed = useMemo(() => Math.round(agents.reduce((sum, agent) => sum + agent.hunger + agent.energy + agent.social, 0) / (agents.length * 3)), [agents]);
  const selected = agents.reduce((lowest, agent) => Math.min(lowest, agent.hunger, agent.energy, agent.social), 100);
  const log = (message: string) => setEvents((current) => [message, ...current].slice(0, 5));

  const triggerDrought = () => { setDrought((value) => !value); log(drought ? "雨云归来，田地重新恢复生机。" : "天空失去雨水：食物再生速度下降。"); };
  const buildKitchen = () => {
    if (wood < 18) return log("木材不足，居民决定先去森林采集。");
    setWood((value) => value - 18); setKitchenLevel((value) => value + 1); setFood((value) => clamp(value + 12)); setMorale((value) => clamp(value + 8)); log(`公共厨房升级到 Lv.${kitchenLevel + 1}：之后的采集会更有效率。`);
  };
  const hostGathering = () => {
    if (food < 12) return log("食物不够举办聚会，居民决定先照料粮仓。");
    setFood((value) => value - 12); setAgents((current) => current.map((agent) => ({ ...agent, social: clamp(agent.social + 20), bond: clamp(agent.bond + 9), status: "正在参加篝火聚会" }))); setMorale((value) => clamp(value + 11)); log("篝火聚会消耗了 12 食物：陌生人交换故事，关系被重新编织。");
  };
  const resolveEvent = (choice: number) => {
    if (!pendingEvent) return;
    if (pendingEvent.title === "井水见底") {
      if (choice === 0) { setFood((value) => Math.max(0, value - 8)); setMorale((value) => clamp(value - 3)); }
      if (choice === 1 && wood >= 10) { setWood((value) => value - 10); setDrought(false); setMorale((value) => clamp(value + 7)); }
      if (choice === 1 && wood < 10) return log("木材不够修井，这个决定只能暂时搁置。");
      if (choice === 2) setMorale((value) => clamp(value - 6));
    } else {
      if (choice === 0) { setFood((value) => Math.max(0, value - 10)); setMorale((value) => clamp(value + 5)); }
      if (choice === 1) { setWood((value) => value + 10); setMorale((value) => clamp(value + 2)); }
      if (choice === 2) setMorale((value) => clamp(value - 6));
    }
    log(`你选择了：${pendingEvent.choices[choice]}`); setPendingEvent(null);
  };

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">LIVING WORLD / MVP 0.2</p><h1>苔原 · 一个会生活的小世界</h1></div><div className="clock"><span className={running ? "pulse" : ""}></span>第 {tick} 个世界循环</div></header>
    <section className="controlbar" aria-label="世界控制"><button className="primary" onClick={() => setRunning((value) => !value)}>{running ? "暂停世界" : "继续演进"}</button><div className="speed-control"><span>时间</span>{[1, 2, 4].map((value) => <button key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>{value}×</button>)}</div><button onClick={triggerDrought} className={drought ? "warning active" : "warning"}>{drought ? "结束旱灾" : "触发旱灾"}</button><button onClick={buildKitchen}>升级厨房 · 18 木材</button><button onClick={hostGathering}>篝火聚会 · 12 食物</button></section>
    <section className="dashboard"><div className="world-panel"><div className="world-header"><div><span className="map-dot"></span>可观察世界</div><span>{drought ? "☀ 旱季" : "☁ 温和天气"}</span></div><div className="map" aria-label="聚落世界地图">{terrain.map((type, i) => <div className={`tile ${type}`} key={i}>{type === "forest" && "♣"}{type === "ore" && "◆"}{type === "village" && (i === 103 ? "⌂" : "")}</div>)}{agents.map((agent) => <div className="agent" key={agent.id} title={`${agent.name}：${agent.status}`} style={{ left: `calc(${agent.x} * 6.25% + 1.5%)`, top: `calc(${agent.y} * 9.09% + 2%)`, backgroundColor: agent.color }}>{agent.name.slice(0, 1)}</div>)}</div><div className="legend"><span><i className="l-grass"></i>草地</span><span><i className="l-forest"></i>森林</span><span><i className="l-village"></i>聚落</span><span><i className="l-water"></i>水域</span><span><b></b>居民</span></div></div>
      <aside className="side-panel"><section className="metric-card"><p>聚落状态</p><div className="health"><strong>{averageNeed}</strong><span>整体需求满足</span></div><div className="bar"><span style={{ width: `${averageNeed}%` }}></span></div><small>最低需求：{selected} / 100</small></section><section className="resources"><p>共享资源</p><div><span>🍲 食物</span><b>{food}</b></div><div><span>🪵 木材</span><b>{wood}</b></div><div><span>✦ 士气</span><b>{morale}</b></div></section><section className="decision"><p>世界的难题</p>{pendingEvent ? <><strong>{pendingEvent.title}</strong><span>{pendingEvent.body}</span><div>{pendingEvent.choices.map((choice, index) => <button key={choice} onClick={() => resolveEvent(index)}>{choice}</button>)}</div></> : <span className="waiting">每 10 个循环会出现一个需要你决定的事件。</span>}</section><section className="story"><p>世界正在发生</p>{events.map((event, index) => <div className="event" key={`${event}-${index}`}><span>0{index + 1}</span>{event}</div>)}</section></aside></section>
    <section className="people"><div className="section-title"><div><p className="eyebrow">8 名自主居民</p><h2>每个人都在做自己的选择</h2></div><span>{agents.filter((agent) => agent.status.includes("聊天")).length} 人正在建立关系 · 厨房 Lv.{kitchenLevel}</span></div><div className="people-grid">{agents.map((agent) => <article key={agent.id} className="person"><div className="avatar" style={{ background: agent.color }}>{agent.name.slice(0, 1)}</div><div className="person-head"><strong>{agent.name}</strong><span>{agent.role} · 擅长{agent.skill}</span></div><em>{agent.status} · {agent.trait}</em><div className="needs"><label>饱腹 <b>{Math.round(agent.hunger)}</b><i><span style={{ width: `${agent.hunger}%` }}></span></i></label><label>精力 <b>{Math.round(agent.energy)}</b><i><span style={{ width: `${agent.energy}%` }}></span></i></label><label>社交 <b>{Math.round(agent.social)}</b><i><span style={{ width: `${agent.social}%` }}></span></i></label></div><footer>关系连结 <b>{Math.round(agent.bond)}</b></footer></article>)}</div></section>
  </main>;
}
