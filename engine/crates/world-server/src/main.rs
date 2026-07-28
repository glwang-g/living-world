//! Long-running authoritative process for the first Living World MVP.
//! The browser is a client; this process owns time, state and persistence.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use world_protocol::{Block, Direction, EventRecord, Inventory, Observation, PlaceBlock, PlayerCommand, Pos, WorldEvent, WorldSnapshot};
use world_runner::WorldRunner;

const ADDRESS: &str = "127.0.0.1:8787";

#[derive(Clone)]
struct Persistence { directory: PathBuf, snapshot: PathBuf, events: PathBuf }

impl Persistence {
    fn new() -> Self {
        let directory = std::env::var_os("LIVING_WORLD_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("engine/data"));
        Self { snapshot: directory.join("world.snapshot"), events: directory.join("world.events.log"), directory }
    }

    fn load_world(&self) -> Option<world_core::World> { load_snapshot(&self.snapshot).map(world_core::World::from_snapshot) }

    fn save(&self, runner: &WorldRunner, events: &[WorldEvent]) {
        if let Err(error) = fs::create_dir_all(&self.directory) { eprintln!("cannot create data directory: {error}"); return; }
        if let Err(error) = save_snapshot(&self.snapshot, &runner.world.snapshot()) { eprintln!("cannot save snapshot: {error}"); }
        if !events.is_empty() {
            match OpenOptions::new().create(true).append(true).open(&self.events) {
                Ok(mut file) => for event in events { let record = event_record(runner.world.snapshot().tick, event); let _ = writeln!(file, "{}|{}|{}|{}|{}", record.tick, record.kind, record.actor, location_text(record.location), record.text.replace('|', "/")); },
                Err(error) => eprintln!("cannot append event log: {error}"),
            }
        }
    }

    fn clear_events(&self) {
        if let Err(error) = fs::write(&self.events, "") { eprintln!("cannot clear event log: {error}"); }
    }
}

fn main() -> std::io::Result<()> {
    let persistence = Persistence::new();
    let restored_world = persistence.load_world();
    if restored_world.is_none() { announce_new_world(); }
    let world = restored_world.unwrap_or_else(|| world_core::World::new(20, 12));
    let restored = world.snapshot();
    println!("第{}天，{}；", world_day(restored.tick), if restored.night { "晚上" } else { "白天" });
    let runner = Arc::new(Mutex::new(WorldRunner::from_world(world)));
    let ticking = Arc::clone(&runner); let ticking_persistence = persistence.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let mut runner = ticking.lock().expect("world runner lock");
        let (_, events) = runner.step();
        let snapshot = runner.world.snapshot();
        for event in &events {
            match event {
                WorldEvent::Dawn => {
                    println!("第{}天，白天；", world_day(snapshot.tick));
                }
                WorldEvent::NightStarted => println!("第{}天，晚上；", world_day(snapshot.tick)),
                _ => {}
            }
        }
        ticking_persistence.save(&runner, &events);
    });

    let listener = TcpListener::bind(ADDRESS)?;
    println!("world-server listening on http://{ADDRESS}");
    println!("world data: {}", persistence.directory.display());
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => { let runner = Arc::clone(&runner); let persistence = persistence.clone(); thread::spawn(move || handle_connection(stream, runner, persistence)); }
            Err(error) => eprintln!("connection error: {error}"),
        }
    }
    Ok(())
}

fn world_day(tick: u64) -> u64 { ((tick.saturating_sub(1)) / 24) + 1 }

fn handle_connection(mut stream: TcpStream, runner: Arc<Mutex<WorldRunner>>, persistence: Persistence) {
    let mut bytes = Vec::with_capacity(16 * 1024); let mut chunk = [0_u8; 4096]; let header_end;
    loop {
        let Ok(size) = stream.read(&mut chunk) else { return };
        if size == 0 { return; }
        bytes.extend_from_slice(&chunk[..size]);
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") { header_end = index; break; }
        if bytes.len() > 64 * 1024 { return; }
    }
    let header = String::from_utf8_lossy(&bytes[..header_end]);
    let content_length = header.lines().find_map(|line| line.strip_prefix("Content-Length:").or_else(|| line.strip_prefix("content-length:")).and_then(|value| value.trim().parse::<usize>().ok())).unwrap_or(0);
    while bytes.len() < header_end + 4 + content_length {
        let Ok(size) = stream.read(&mut chunk) else { return };
        if size == 0 { return; }
        bytes.extend_from_slice(&chunk[..size]);
    }
    let request = String::from_utf8_lossy(&bytes);
    let mut sections = request.splitn(2, "\r\n\r\n");
    let head = sections.next().unwrap_or_default(); let body = sections.next().unwrap_or_default(); let mut first_line = head.lines().next().unwrap_or_default().split_whitespace();
    let method = first_line.next().unwrap_or_default(); let path = first_line.next().unwrap_or_default();
    let (status, response) = match (method, path) {
        ("OPTIONS", "/api/command") => ("204 No Content", String::new()),
        ("GET", "/api/snapshot") => { let observation = runner.lock().expect("world runner lock").world.observation(6); ("200 OK", observation_json(&observation)) }
        ("GET", "/api/events") => ("200 OK", events_json(&persistence.events)),
        ("POST", "/api/command") => {
            if let Some(command) = parse_command(body) {
                let is_reset = matches!(command, PlayerCommand::Reset);
                let mut runner = runner.lock().expect("world runner lock");
                if is_reset {
                    println!("当前世界即将重启...");
                    thread::sleep(Duration::from_secs(1));
                    persistence.clear_events();
                }
                runner.command(command);
                let events = runner.world.drain_events();
                persistence.save(&runner, &events);
                if is_reset { announce_new_world(); }
                ("200 OK", "{\"accepted\":true}".to_string())
            }
            else { ("400 Bad Request", "{\"accepted\":false}".to_string()) }
        }
        _ => ("404 Not Found", "{\"error\":\"not found\"}".to_string()),
    };
    let reply = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response);
    let _ = stream.write_all(reply.as_bytes());
}

fn announce_new_world() {
    println!("起初，神创造天地...");
    println!("第1天，白天；");
}

fn save_snapshot(path: &Path, snapshot: &WorldSnapshot) -> std::io::Result<()> {
    let temporary = path.with_extension("snapshot.tmp"); let mut file = std::fs::File::create(&temporary)?;
    writeln!(file, "tick={}", snapshot.tick)?; writeln!(file, "player={},{},{},{}", snapshot.player.x, snapshot.player.y, snapshot.hp, snapshot.night)?;
    writeln!(file, "inventory={},{},{},{}", snapshot.inventory.wood, snapshot.inventory.stone, snapshot.inventory.dirt, snapshot.inventory.torch)?;
    writeln!(file, "modified={}", snapshot.modified.iter().map(|(pos, block)| format!("{},{},{}", pos.x, pos.y, block_name(*block))).collect::<Vec<_>>().join(";"))?;
    writeln!(file, "monsters={}", snapshot.monsters.iter().map(|pos| format!("{},{}", pos.x, pos.y)).collect::<Vec<_>>().join(";"))?;
    file.sync_all()?; fs::rename(temporary, path)
}

fn load_snapshot(path: &Path) -> Option<WorldSnapshot> {
    let text = fs::read_to_string(path).ok()?; let value = |prefix: &str| text.lines().find_map(|line| line.strip_prefix(prefix));
    let tick = value("tick=")?.parse().ok()?;
    let player = value("player=")?.split(',').collect::<Vec<_>>(); if player.len() != 4 { return None; }
    let inventory = value("inventory=")?.split(',').collect::<Vec<_>>(); if inventory.len() != 4 { return None; }
    let modified = value("modified=").unwrap_or_default().split(';').filter_map(|entry| { let parts = entry.split(',').collect::<Vec<_>>(); if parts.len() != 3 { return None; } Some((Pos::new(parts[0].parse().ok()?, parts[1].parse().ok()?), parse_block(parts[2])?)) }).collect();
    let monsters = value("monsters=").unwrap_or_default().split(';').filter_map(|pair| { let (x, y) = pair.split_once(',')?; Some(Pos::new(x.parse().ok()?, y.parse().ok()?)) }).collect();
    Some(WorldSnapshot { tick, player: Pos::new(player[0].parse().ok()?, player[1].parse().ok()?), hp: player[2].parse().ok()?, night: player[3].parse().ok()?, inventory: Inventory { wood: inventory[0].parse().ok()?, stone: inventory[1].parse().ok()?, dirt: inventory[2].parse().ok()?, torch: inventory[3].parse().ok()? }, monsters, modified })
}

fn parse_command(body: &str) -> Option<PlayerCommand> { let command = string_field(body, "command")?; match command.as_str() { "move" => match string_field(body, "direction")?.as_str() { "up" => Some(PlayerCommand::Move(Direction::Up)), "down" => Some(PlayerCommand::Move(Direction::Down)), "left" => Some(PlayerCommand::Move(Direction::Left)), "right" => Some(PlayerCommand::Move(Direction::Right)), _ => None }, "break" => Some(PlayerCommand::BreakAt(Pos::new(number_field(body, "x")?, number_field(body, "y")?))), "place" => { let block = match string_field(body, "block")?.as_str() { "wood" => PlaceBlock::WoodWall, "stone" => PlaceBlock::Stone, "dirt" => PlaceBlock::Dirt, "torch" => PlaceBlock::Torch, _ => return None }; Some(PlayerCommand::PlaceAt(Pos::new(number_field(body, "x")?, number_field(body, "y")?), block)) }, "wait" => Some(PlayerCommand::Wait), "reset" => Some(PlayerCommand::Reset), _ => None } }
fn string_field(body: &str, name: &str) -> Option<String> { let marker = format!("\"{name}\":\""); let start = body.find(&marker)? + marker.len(); let end = body[start..].find('"')? + start; Some(body[start..end].to_string()) }
fn number_field(body: &str, name: &str) -> Option<i32> { let marker = format!("\"{name}\":"); let start = body.find(&marker)? + marker.len(); let end = body[start..].find(|character: char| !character.is_ascii_digit() && character != '-').map(|offset| start + offset).unwrap_or(body.len()); body[start..end].parse().ok() }
fn parse_block(value: &str) -> Option<Block> { Some(match value { "grass" => Block::Grass, "tree" => Block::Tree, "stone" => Block::Stone, "water" => Block::Water, "dirt" => Block::Dirt, "wall" => Block::Wall, "torch" => Block::Torch, _ => return None }) }
fn block_name(block: Block) -> &'static str { match block { Block::Grass => "grass", Block::Tree => "tree", Block::Stone => "stone", Block::Water => "water", Block::Dirt => "dirt", Block::Wall => "wall", Block::Torch => "torch", Block::Unknown => "unknown" } }
fn observation_json(observation: &Observation) -> String { let blocks = observation.nearby.iter().map(|(_, block)| format!("\"{}\"", block_name(*block))).collect::<Vec<_>>().join(","); let monsters = observation.monsters.iter().map(|pos| format!("{{\"x\":{},\"y\":{}}}", pos.x, pos.y)).collect::<Vec<_>>().join(","); let sounds = observation.sounds.iter().map(|sound| format!("\"{}\"", json_escape(sound))).collect::<Vec<_>>().join(","); format!("{{\"tick\":{},\"origin_x\":{},\"origin_y\":{},\"width\":{},\"height\":{},\"blocks\":[{}],\"player\":{{\"x\":{},\"y\":{}}},\"hp\":{},\"inventory\":{{\"wood\":{},\"stone\":{},\"dirt\":{},\"torch\":{}}},\"monsters\":[{}],\"sounds\":[{}],\"night\":{}}}", observation.tick, observation.origin.x, observation.origin.y, observation.width, observation.height, blocks, observation.self_pos.x, observation.self_pos.y, observation.hp, observation.inventory.wood, observation.inventory.stone, observation.inventory.dirt, observation.inventory.torch, monsters, sounds, observation.night) }

fn event_record(tick: u64, event: &WorldEvent) -> EventRecord { let (actor, kind, location, text) = match event { WorldEvent::Moved { from, to } => ("player", "movement", Some(*to), format!("你从 ({},{}) 走到了 ({},{})。", from.x, from.y, to.x, to.y)), WorldEvent::BlockBroken { pos, block } => ("player", "mining", Some(*pos), format!("你在 ({},{}) 挖掉了 {}。", pos.x, pos.y, block_name(*block))), WorldEvent::BlockPlaced { pos, block } => ("player", "building", Some(*pos), format!("你在 ({},{}) 放置了 {}。", pos.x, pos.y, block_name(*block))), WorldEvent::ItemCollected { item, amount } => ("player", "inventory", None, format!("你获得了 {} ×{}。", place_name(*item), amount)), WorldEvent::NightStarted => ("world", "night", None, "夜晚降临，黑暗里的东西醒来了。".into()), WorldEvent::Dawn => ("world", "dawn", None, "太阳升起，森林恢复了安静。".into()), WorldEvent::MonsterSpawned { pos } => ("monster", "spawn", Some(*pos), format!("一个怪物在 ({},{}) 出现了。", pos.x, pos.y)), WorldEvent::PlayerHurt { hp } => ("player", "damage", None, format!("你受伤了，剩余生命 {}。", hp)), WorldEvent::Message(message) => ("world", "message", None, message.clone()) }; EventRecord { tick, actor: actor.into(), kind: kind.into(), location, text } }
fn place_name(item: PlaceBlock) -> &'static str { match item { PlaceBlock::WoodWall => "木材", PlaceBlock::Stone => "石头", PlaceBlock::Dirt => "泥土", PlaceBlock::Torch => "火把" } }
fn location_text(location: Option<Pos>) -> String { location.map(|pos| format!("{},{}", pos.x, pos.y)).unwrap_or_else(|| "-".into()) }
fn json_escape(value: &str) -> String { value.replace('\\', "\\\\").replace('"', "\\\"") }
fn events_json(path: &Path) -> String { let Ok(text) = fs::read_to_string(path) else { return "[]".into() }; let events = text.lines().filter_map(|line| { let parts = line.splitn(5, '|').collect::<Vec<_>>(); if parts.len() == 5 { let tick = parts[0].parse::<u64>().ok()?; let location = if parts[3] == "-" { "null".into() } else { let coords = parts[3].split_once(',')?; format!("{{\"x\":{},\"y\":{}}}", coords.0, coords.1) }; return Some(format!("{{\"tick\":{},\"actor\":\"{}\",\"kind\":\"{}\",\"location\":{},\"text\":\"{}\"}}", tick, json_escape(parts[2]), json_escape(parts[1]), location, json_escape(parts[4]))); } let tick = line.strip_prefix("tick=")?.split_once(" event=")?.0.parse::<u64>().ok()?; let text = line.split_once(" event=")?.1; Some(format!("{{\"tick\":{},\"actor\":\"world\",\"kind\":\"legacy\",\"location\":null,\"text\":\"{}\"}}", tick, json_escape(text))) }).collect::<Vec<_>>(); format!("[{}]", events.join(",")) }
