//! The authoritative, deterministic world rules. The world has no fixed edge:
//! terrain is generated from coordinates and only player changes are stored.

use std::collections::HashMap;
use world_protocol::{Block, Direction, Inventory, Observation, PlaceBlock, PlayerCommand, Pos, WorldEvent, WorldSnapshot};

const MAX_HP: u8 = 5;
const INITIAL_WIDTH: i32 = 20;
const INITIAL_HEIGHT: i32 = 12;

pub struct World {
    tick: u64,
    modified: HashMap<Pos, Block>,
    player: Pos,
    hp: u8,
    inventory: Inventory,
    monsters: Vec<Pos>,
    night: bool,
    events: Vec<WorldEvent>,
}

impl World {
    pub fn new(_width: u32, _height: u32) -> Self {
        Self { tick: 6, modified: HashMap::new(), player: Pos::new(9, 6), hp: MAX_HP, inventory: Inventory { wood: 6, stone: 3, dirt: 12, torch: 4 }, monsters: Vec::new(), night: false, events: Vec::new() }
    }

    pub fn from_snapshot(snapshot: WorldSnapshot) -> Self {
        Self { tick: snapshot.tick, modified: snapshot.modified.into_iter().collect(), player: snapshot.player, hp: snapshot.hp, inventory: snapshot.inventory, monsters: snapshot.monsters, night: snapshot.night, events: Vec::new() }
    }

    pub fn tick(&mut self) {
        self.tick += 1;
        let hour = (self.tick - 1) % 24;
        let night = hour >= 16 || hour < 5;
        if night != self.night {
            self.night = night;
            self.events.push(if night { WorldEvent::NightStarted } else { WorldEvent::Dawn });
            if night && self.monsters.is_empty() { let pos = Pos::new(self.player.x + 3, self.player.y); self.monsters.push(pos); self.events.push(WorldEvent::MonsterSpawned { pos }); }
            if !night { self.monsters.clear(); }
        }
        if self.night && self.monsters.iter().any(|monster| monster.distance(self.player) == 1) {
            self.hp = self.hp.saturating_sub(1);
            self.events.push(WorldEvent::PlayerHurt { hp: self.hp });
        }
    }

    pub fn apply(&mut self, command: PlayerCommand) {
        match command {
            PlayerCommand::Move(direction) => self.move_player(direction),
            PlayerCommand::BreakAt(pos) => self.break_at(pos),
            PlayerCommand::PlaceAt(pos, block) => self.place_at(pos, block),
            PlayerCommand::Wait => self.events.push(WorldEvent::Message("你等待了一回合。".into())),
            PlayerCommand::Reset => { *self = Self::new(INITIAL_WIDTH as u32, INITIAL_HEIGHT as u32); self.events.push(WorldEvent::Message("世界重新开始了。".into())); }
        }
    }

    pub fn snapshot(&self) -> WorldSnapshot {
        let mut modified = self.modified.iter().map(|(pos, block)| (*pos, *block)).collect::<Vec<_>>();
        modified.sort_by_key(|(pos, _)| (pos.y, pos.x));
        WorldSnapshot { tick: self.tick, player: self.player, hp: self.hp, inventory: self.inventory.clone(), monsters: self.monsters.clone(), night: self.night, modified }
    }

    pub fn observation(&self, radius: i32) -> Observation {
        let radius = radius.max(1);
        let origin = Pos::new(self.player.x - radius, self.player.y - radius);
        let width = (radius * 2 + 1) as u32;
        let visibility_radius = if self.night { 3 } else { radius };
        let mut nearby = Vec::with_capacity((width * width) as usize);
        for y in origin.y..=self.player.y + radius { for x in origin.x..=self.player.x + radius { let pos = Pos::new(x, y); let visible = pos.distance(self.player) <= visibility_radius || self.torch_lights(pos); nearby.push((pos, if visible && self.line_of_sight(pos) { self.block_at(pos) } else { Block::Unknown })); } }
        let monsters = self.monsters.iter().copied().filter(|pos| self.visible(*pos, visibility_radius)).collect::<Vec<_>>();
        let mut sounds = Vec::new();
        if self.monsters.iter().any(|pos| pos.distance(self.player) <= radius + 3 && !self.visible(*pos, visibility_radius)) { sounds.push("你听见远处有脚步声。".into()); }
        if self.night && !self.torch_lights(self.player) { sounds.push("黑暗正在靠近。".into()); }
        Observation { tick: self.tick, origin, width, height: width, self_pos: self.player, hp: self.hp, night: self.night, inventory: self.inventory.clone(), nearby, monsters, sounds }
    }

    pub fn drain_events(&mut self) -> Vec<WorldEvent> { std::mem::take(&mut self.events) }

    fn generated_block(pos: Pos) -> Block {
        if pos.x >= 0 && pos.y >= 0 && pos.x < INITIAL_WIDTH && pos.y < INITIAL_HEIGHT {
            let x = pos.x; let y = pos.y;
            if (x * 11 + y * 7).rem_euclid(23) == 0 || (x == 4 && y > 2 && y < 8) { return Block::Tree; }
            if (x * 5 + y * 13).rem_euclid(29) == 0 { return Block::Stone; }
            if (x * 3 + y * 5).rem_euclid(17) == 0 { return Block::Dirt; }
            return Block::Grass;
        }
        let hash = ((pos.x as i64).wrapping_mul(1103515245) ^ (pos.y as i64).wrapping_mul(12345)).unsigned_abs();
        if hash % 37 == 0 { Block::Water } else if hash % 23 == 0 { Block::Tree } else if hash % 31 == 0 { Block::Stone } else if hash % 17 == 0 { Block::Dirt } else { Block::Grass }
    }

    fn block_at(&self, pos: Pos) -> Block { self.modified.get(&pos).copied().unwrap_or_else(|| Self::generated_block(pos)) }
    fn walkable(block: Block) -> bool { matches!(block, Block::Grass | Block::Torch) }
    fn set_block(&mut self, pos: Pos, block: Block) { self.modified.insert(pos, block); }
    fn visible(&self, pos: Pos, radius: i32) -> bool { pos.distance(self.player) <= radius && self.line_of_sight(pos) }
    fn torch_lights(&self, pos: Pos) -> bool { self.modified.iter().any(|(torch, block)| *block == Block::Torch && torch.distance(pos) <= 4 && self.line_of_sight_from(*torch, pos)) }
    fn line_of_sight(&self, pos: Pos) -> bool { self.line_of_sight_from(self.player, pos) }
    fn line_of_sight_from(&self, from: Pos, to: Pos) -> bool {
        let steps = (to.x - from.x).abs().max((to.y - from.y).abs());
        if steps <= 1 { return true; }
        for step in 1..steps { let x = from.x + (to.x - from.x) * step / steps; let y = from.y + (to.y - from.y) * step / steps; if self.block_at(Pos::new(x, y)) == Block::Wall { return false; } }
        true
    }
    fn adjacent(&self, direction: Direction) -> Pos { let (x, y) = direction.offset(); Pos::new(self.player.x + x, self.player.y + y) }
    fn move_player(&mut self, direction: Direction) {
        let next = self.adjacent(direction);
        if !Self::walkable(self.block_at(next)) { self.events.push(WorldEvent::Message("那里被资源挡住了，先挖开再走。".into())); return; }
        let from = self.player; self.player = next; self.events.push(WorldEvent::Moved { from, to: next });
    }
    fn break_at(&mut self, target: Pos) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        let block = self.block_at(target);
        let gain = match block { Block::Tree => Some((PlaceBlock::WoodWall, 2)), Block::Stone => Some((PlaceBlock::Stone, 1)), Block::Dirt => Some((PlaceBlock::Dirt, 2)), Block::Wall => Some((PlaceBlock::WoodWall, 1)), Block::Torch => Some((PlaceBlock::Torch, 1)), _ => None };
        let Some((item, amount)) = gain else { self.events.push(WorldEvent::Message("这块方块没有可以采集的材料。".into())); return };
        self.set_block(target, Block::Grass); self.add_item(item, amount); self.events.push(WorldEvent::BlockBroken { pos: target, block }); self.events.push(WorldEvent::ItemCollected { item, amount });
    }
    fn place_at(&mut self, target: Pos, item: PlaceBlock) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        if self.block_at(target) != Block::Grass { self.events.push(WorldEvent::Message("这里只能在草地上放置。".into())); return; }
        if !self.remove_item(item) { self.events.push(WorldEvent::Message("你的材料不够。".into())); return; }
        let block = match item { PlaceBlock::WoodWall => Block::Wall, PlaceBlock::Stone => Block::Stone, PlaceBlock::Dirt => Block::Dirt, PlaceBlock::Torch => Block::Torch };
        self.set_block(target, block); self.events.push(WorldEvent::BlockPlaced { pos: target, block });
    }
    fn add_item(&mut self, item: PlaceBlock, amount: u8) { match item { PlaceBlock::WoodWall => self.inventory.wood += amount as u32, PlaceBlock::Stone => self.inventory.stone += amount as u32, PlaceBlock::Dirt => self.inventory.dirt += amount as u32, PlaceBlock::Torch => self.inventory.torch += amount as u32 } }
    fn remove_item(&mut self, item: PlaceBlock) -> bool { let value = match item { PlaceBlock::WoodWall => &mut self.inventory.wood, PlaceBlock::Stone => &mut self.inventory.stone, PlaceBlock::Dirt => &mut self.inventory.dirt, PlaceBlock::Torch => &mut self.inventory.torch }; if *value == 0 { false } else { *value -= 1; true } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn world_is_deterministic() { assert_eq!(World::new(20, 12).snapshot(), World::new(20, 12).snapshot()); }
    #[test] fn time_crosses_into_night() { let mut world = World::new(20, 12); for _ in 0..16 { world.tick(); } assert!(world.snapshot().night); assert!(world.drain_events().contains(&WorldEvent::NightStarted)); }
    #[test] fn movement_can_leave_initial_area() { let mut world = World::new(20, 12); for x in 10..=23 { world.set_block(Pos::new(x, 6), Block::Grass); } for _ in 0..14 { world.apply(PlayerCommand::Move(Direction::Right)); } assert_eq!(world.snapshot().player, Pos::new(23, 6)); }
    #[test] fn modifications_survive_snapshot_round_trip() { let mut world = World::new(20, 12); world.apply(PlayerCommand::BreakAt(Pos::new(10, 6))); let snapshot = world.snapshot(); let restored = World::from_snapshot(snapshot); assert_eq!(restored.observation(1).nearby, world.observation(1).nearby); }
    #[test] fn only_grass_and_torches_are_walkable() { let mut world = World::new(20, 12); for (offset, block) in [(1, Block::Tree), (2, Block::Stone), (3, Block::Dirt), (4, Block::Torch), (5, Block::Wall), (6, Block::Water)] { world.set_block(Pos::new(9 + offset, 6), block); } world.apply(PlayerCommand::Move(Direction::Right)); assert_eq!(world.snapshot().player, Pos::new(9, 6)); world.set_block(Pos::new(10, 6), Block::Torch); world.apply(PlayerCommand::Move(Direction::Right)); assert_eq!(world.snapshot().player, Pos::new(10, 6)); }
    #[test] fn night_reduces_visibility() { let mut world = World::new(20, 12); let daylight = world.observation(6); assert_ne!(daylight.nearby.iter().find(|(pos, _)| *pos == Pos::new(14, 6)).unwrap().1, Block::Unknown); for _ in 0..11 { world.tick(); } let night = world.observation(6); assert_eq!(night.nearby.iter().find(|(pos, _)| *pos == Pos::new(14, 6)).unwrap().1, Block::Unknown); }
    #[test] fn torch_reveals_darkness() { let mut world = World::new(20, 12); world.apply(PlayerCommand::PlaceAt(Pos::new(10, 6), PlaceBlock::Torch)); for _ in 0..11 { world.tick(); } let observation = world.observation(6); assert_eq!(observation.nearby.iter().find(|(pos, _)| *pos == Pos::new(13, 6)).unwrap().1, Block::Grass); }
}
