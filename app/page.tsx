"use client";

import { FormEvent, useMemo, useState } from "react";

type Agent = { name: string; role: string; trait: string; color: string; status: string; place: string };
type LogEntry = { turn: number; place: string; text: string; tone?: "system" | "choice" };
type AdventureLog = { place: string; text: string; tone?: "danger" | "choice" | "normal" };

const agents: Agent[] = [
  { name: "阿岚", role: "采集者", trait: "热心但冲动", color: "#fa9c55", status: "在河边观察水位", place: "河边" },
  { name: "小满", role: "农夫", trait: "安静而敏锐", color: "#75c5b9", status: "在营地整理种子", place: "营地" },
  { name: "石头", role: "工匠", trait: "务实可靠", color: "#b88cde", status: "在工坊修理水泵", place: "工坊" },
  { name: "月芽", role: "观察者", trait: "喜欢冒险", color: "#f5d36c", status: "刚从森林回来", place: "森林" },
];

const places: Record<string, { title: string; description: string; exits: string[] }> = {
  营地: { title: "营地", description: "火堆还亮着。小满把一排湿种子摊在木板上，远处有人在争论晚餐。", exits: ["森林", "工坊", "河边"] },
  森林: { title: "森林", description: "潮湿的树叶遮住了天空。你听见更深处传来金属碰撞声，但看不见是谁。", exits: ["营地", "废墟"] },
  工坊: { title: "工坊", description: "石头的工具铺满桌面。水泵拆开了一半，铜牌被压在图纸下面。", exits: ["营地", "河边"] },
  河边: { title: "河边", description: "河床比昨天又低了一寸。阿岚蹲在裂缝旁，手里捏着一枚陌生的铜制徽记。", exits: ["营地", "工坊"] },
  废墟: { title: "旧哨站", description: "坍塌的石墙上刻着和铜牌相同的徽记。这里不像是被遗弃，更像是有人刚离开。", exits: ["森林"] },
};

const history: Record<string, Array<{ day: string; title: string; text: string; truth?: boolean }>> = {
  阿岚: [
    { day: "第 1 日", title: "来到营地", text: "阿岚主动接过了第一批木材。他说自己不喜欢欠别人东西。" },
    { day: "第 6 日", title: "第一次争执", text: "他和石头因为水泵的维修方案发生争吵，关系下降。", truth: true },
    { day: "第 12 日", title: "河边的铜牌", text: "阿岚在干涸的河床发现了陌生徽记，但没有告诉聚落。" },
    { day: "第 15 日", title: "隐瞒", text: "他把铜牌交给了小满。两人约定暂时不让石头知道。", truth: true },
    { day: "现在", title: "河水退去", text: "阿岚正在等待你决定：把铜牌带回营地，还是继续调查河床。" },
  ],
  小满: [
    { day: "第 1 日", title: "留下", text: "小满在第一场旱灾前留下来照料种子。" },
    { day: "第 9 日", title: "藏起浆果", text: "她把最后一篮浆果藏了起来，没有告诉其他人。", truth: true },
    { day: "第 15 日", title: "收到铜牌", text: "阿岚把铜牌交给小满。她似乎认得上面的图案。" },
  ],
};

const initialLog: LogEntry[] = [
  { turn: 18, place: "营地", text: "世界醒来。你站在火堆边，所有人都在忙自己的事。", tone: "system" },
  { turn: 18, place: "营地", text: "小满抬头看你：“今天要去哪里？”" },
];

export default function Home() {
  const [mode, setMode] = useState<"role" | "history" | "adventure">("role");
  const [selected, setSelected] = useState("阿岚");
  const [place, setPlace] = useState("营地");
  const [turn, setTurn] = useState(18);
  const [command, setCommand] = useState("");
  const [log, setLog] = useState(initialLog);
  const current = places[place];
  const selectedAgent = agents.find((agent) => agent.name === selected) ?? agents[0];
  const selectedHistory = history[selected] ?? history.阿岚;

  const addLog = (text: string, nextPlace = place, tone?: LogEntry["tone"]) => {
    setTurn((value) => value + 1);
    setLog((value) => [...value, { turn: turn + 1, place: nextPlace, text, tone }]);
  };

  const move = (nextPlace: string) => {
    if (!current.exits.includes(nextPlace)) return addLog(`你试图前往${nextPlace}，但这条路被倒下的树挡住了。`);
    setPlace(nextPlace);
    addLog(`你沿着小路走向${nextPlace}。`, nextPlace, "choice");
  };

  const perform = (action: string) => {
    if (action === "observe") addLog(`${current.description}`);
    if (action === "talk") addLog(selected === "阿岚" ? "阿岚把铜牌在指间翻了一面：“你觉得这个徽记，像不像某种路标？”" : `${selected}没有立刻回答。他正在忙着处理自己的事情。`);
    if (action === "follow") addLog(`你决定跟着${selected}走。${selected}没有阻止你，但明显加快了脚步。`, selectedAgent.place);
    if (action === "inspect") addLog(place === "河边" ? "你在裂缝里找到一小片蓝色漆片，和旧哨站墙上的颜色一致。" : "你仔细查看周围，没有发现新的线索。", undefined, "choice");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    const destination = Object.keys(places).find((name) => value.includes(name));
    if (value.includes("观察")) perform("observe");
    else if (value.includes("交谈") || value.includes("询问")) perform("talk");
    else if (value.includes("跟随")) perform("follow");
    else if (destination) move(destination);
    else addLog(`你尝试“${value}”。这个世界还没有理解这个动作，但它记住了你的意图。`);
    setCommand("");
  };

  const visibleAgents = useMemo(() => agents.filter((agent) => agent.place === place || agent.name === selected), [place, selected]);

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">LIVING WORLD / MUD CHRONICLE</p><h1>苔原 · 第十八日</h1><span className="subtitle">一个正在发生、也值得被回看的小世界</span></div><div className="view-switch"><button className={mode === "role" ? "active" : ""} onClick={() => setMode("role")}>角色视角</button><button className={mode === "adventure" ? "active" : ""} onClick={() => setMode("adventure")}>冒险</button><button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}>历史视角</button></div></header>
    {mode === "role" ? <>
      <section className="mud-layout"><aside className="character-rail"><p className="eyebrow">你正在扮演</p><div className="hero-avatar" style={{ background: selectedAgent.color }}>{selected.slice(0, 1)}</div><h2>{selected}</h2><p>{selectedAgent.role} · {selectedAgent.trait}</p><div className="rail-rule"></div><p className="eyebrow">附近的人</p>{visibleAgents.map((agent) => <button className={`agent-row ${agent.name === selected ? "chosen" : ""}`} key={agent.name} onClick={() => setSelected(agent.name)}><i style={{ background: agent.color }}>{agent.name.slice(0, 1)}</i><span><strong>{agent.name}</strong><small>{agent.status}</small></span></button>)}<div className="rail-note">世界会继续行动。你不知道的事，不会因为你没看见就停止发生。</div></aside>
        <section className="console"><div className="location-head"><div><p className="eyebrow">当前地点</p><h2>{current.title}</h2></div><span>第 {turn} 回合 · {selectedAgent.role}</span></div><p className="location-description">{current.description}</p><div className="log"><div className="log-label">行动记录</div>{log.slice(-8).map((entry, index) => <div className={`log-entry ${entry.tone ?? ""}`} key={`${entry.turn}-${index}`}><span className="log-meta">{entry.turn} · {entry.place}</span><p>{entry.text}</p></div>)}</div><form className="command-line" onSubmit={submit}><span>›</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="输入动作，例如：去森林、观察、和阿岚交谈" aria-label="输入动作" /><button>执行</button></form><div className="quick-actions"><button onClick={() => perform("observe")}>观察这里</button><button onClick={() => perform("talk")}>和 {selected} 交谈</button><button onClick={() => perform("follow")}>跟随 {selected}</button><button onClick={() => perform("inspect")}>寻找线索</button></div></section>
        <aside className="world-rail"><p className="eyebrow">地点出口</p>{current.exits.map((exit) => <button className="place-button" key={exit} onClick={() => move(exit)}><span>↗</span>{exit}</button>)}<div className="map-mini"><div className="map-path path-a"></div><div className="map-path path-b"></div><b className="map-place camp">营</b><b className="map-place forest">森</b><b className="map-place river">河</b><b className="map-place ruins">墟</b><i className="map-you">你</i></div><p className="eyebrow">聚落状态</p><div className="quiet-stats"><span>粮食 <b>86</b></span><span>士气 <b>71</b></span><span>关系 <b>4</b></span></div></aside></section>
    </> : mode === "history" ? <section className="history-layout"><aside className="history-people"><p className="eyebrow">查看谁的历史</p>{agents.map((agent) => <button className={`history-person ${agent.name === selected ? "chosen" : ""}`} key={agent.name} onClick={() => setSelected(agent.name)}><i style={{ background: agent.color }}>{agent.name.slice(0, 1)}</i><span><strong>{agent.name}</strong><small>{agent.role}</small></span></button>)}<p className="history-warning">历史视角可以看到角色不知道的事。回到角色视角后，这些事实不会自动变成你的记忆。</p></aside><section className="chronicle"><div className="location-head"><div><p className="eyebrow">{selected} 的完整编年史</p><h2>一个人如何变成现在这样</h2></div><span>共 {selectedHistory.length} 个关键时刻</span></div><div className="timeline">{selectedHistory.map((item, index) => <article className={`timeline-item ${item.truth ? "revealed" : ""}`} key={`${item.day}-${item.title}`}><div className="timeline-dot"></div><span className="timeline-day">{item.day}</span><h3>{item.title}</h3><p>{item.text}</p>{item.truth && <em>角色当时并不知道</em>}</article>)}</div></section><aside className="history-summary"><p className="eyebrow">关系回声</p><h3>{selected} 与这个世界</h3><p>阿岚正在河边寻找答案。小满知道一部分真相，石头还在修理那台坏掉的水泵。</p><div className="relation-line"><span>阿岚</span><i></i><span>小满</span><b>秘密</b></div><div className="relation-line"><span>阿岚</span><i className="cold"></i><span>石头</span><b>不信任</b></div></aside></section> : <AdventureView hero={selected} onReturn={() => setMode("role")} />}
  </main>;
}

function AdventureView({ hero, onReturn }: { hero: string; onReturn: () => void }) {
  const [place, setPlace] = useState("森林边缘");
  const [hp, setHp] = useState(3);
  const [supplies, setSupplies] = useState(2);
  const [clue, setClue] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [log, setLog] = useState<AdventureLog[]>([
    { place: "营地", text: `${hero} 带上火把和两份干粮，向森林里的旧哨站出发。` },
    { place: "森林边缘", text: "树影合拢。前方有两条路：一条通往哨站，一条通往更深的林子。" },
  ]);
  const add = (text: string, nextPlace = place, tone: AdventureLog["tone"] = "normal") => setLog((current) => [...current, { place: nextPlace, text, tone }]);
  const goOutpost = () => { setPlace("旧哨站"); add("你沿着带血的爪印来到旧哨站。石墙后传来低沉的喘息。", "旧哨站", "danger"); };
  const inspect = () => { setClue(true); add("你发现灰鳞兽的左前爪受了伤。它不是在守卫，而是在保护巢里的幼崽。", "旧哨站", "choice"); };
  const useTorch = () => { if (supplies < 1) return add("火把已经烧完了。", "旧哨站", "danger"); setSupplies((value) => value - 1); setResolved(true); add("你点燃火把照向石墙。灰鳞兽后退了，但没有攻击。它让出了一条路。", "旧哨站", "choice"); };
  const feed = () => { if (supplies < 1) return add("你没有可以分享的食物。", "旧哨站", "danger"); setSupplies((value) => value - 1); setResolved(true); add("你把干粮放在地上。灰鳞兽嗅了很久，叼走食物后消失在阴影里。", "旧哨站", "choice"); };
  const fight = () => { setHp((value) => Math.max(0, value - 1)); setResolved(true); add("你举起武器。短暂的搏斗后，灰鳞兽负伤逃入废墟，你也被抓伤了。", "旧哨站", "danger"); };
  const retreat = () => { setPlace("森林边缘"); add("你退回森林边缘。身后的喘息声没有追来。", "森林边缘", "choice"); };
  const finishText = hp === 0 ? "你倒在旧哨站前。幸好月芽找到了你，把你拖回了营地。" : resolved ? "你完成了这次探索。回到营地后，这件事会改变居民对森林的看法。" : "灰鳞兽还在石墙后。先观察，再决定要不要冒险。";
  return <section className="adventure-shell"><div className="adventure-head"><div><p className="eyebrow">EXPEDITION / OLD WATCHTOWER</p><h2>森林里的旧哨站</h2><p>一次冒险不是为了刷掉一条血条，而是为了带回一个会改变聚落的故事。</p></div><button onClick={onReturn}>回到角色视角</button></div><div className="adventure-grid"><aside className="expedition-path"><p className="eyebrow">探索路线</p><div className={`path-step ${place === "森林边缘" ? "current" : "done"}`}><b>01</b><span>森林边缘<small>听见不属于人的声音</small></span></div><div className={`path-step ${place === "旧哨站" ? "current" : resolved ? "done" : ""}`}><b>02</b><span>旧哨站<small>灰鳞兽与废墟徽记</small></span></div><div className="path-step"><b>03</b><span>地下蓄水室<small>完成探索后解锁</small></span></div><div className="adventure-status"><span>体力 <b>{"♥".repeat(hp)}<i>{"♡".repeat(3 - hp)}</i></b></span><span>补给 <b>{supplies}</b></span><span>同行者 <b>{hero}</b></span></div></aside><section className="encounter"><div className="encounter-log">{log.map((entry, index) => <article className={entry.tone ?? ""} key={`${entry.place}-${index}`}><span>{entry.place}</span><p>{entry.text}</p></article>)}</div><div className="encounter-action"><p className="eyebrow">现在可以做什么</p>{place === "森林边缘" && <div className="action-grid"><button onClick={goOutpost}><strong>沿爪印前进</strong><small>去旧哨站寻找声音的来源</small></button><button onClick={() => add("你在树根下找到一块旧布条，上面绣着和铜牌相同的徽记。", "森林边缘", "choice")}><strong>调查树根</strong><small>先寻找线索，不急着冒险</small></button></div>}{place === "旧哨站" && !resolved && <div className="action-grid"><button onClick={inspect}><strong>观察灰鳞兽</strong><small>寻找弱点或它真正的目的</small></button><button onClick={useTorch}><strong>举起火把</strong><small>消耗 1 补给，逼它后退</small></button><button onClick={feed}><strong>投喂干粮</strong><small>消耗 1 补给，尝试和平解决</small></button><button className="danger-button" onClick={fight}><strong>直接战斗</strong><small>可能受伤，但能夺回通道</small></button><button onClick={retreat}><strong>撤退</strong><small>保留体力，之后再来</small></button></div>}{place === "旧哨站" && !resolved && clue && <p className="clue-note">线索：它在保护什么，而不是攻击什么。</p>}{resolved && <div className="outcome"><strong>{hp === 0 ? "探索失败，但故事没有结束" : "探索完成"}</strong><p>{finishText}</p><button onClick={onReturn}>把结果带回聚落</button></div>}</div></section></div></section>;
}
