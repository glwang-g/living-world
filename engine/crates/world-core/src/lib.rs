//! The authoritative, deterministic world rules. The world has no fixed edge:
//! terrain is generated from coordinates and only player changes are stored.

use std::collections::{HashMap, VecDeque};
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
        if self.night { self.monster_turn(); }
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
        self.observation_window((radius * 2 + 1) as u32, (radius * 2 + 1) as u32)
    }

    pub fn observation_window(&self, width: u32, height: u32) -> Observation {
        let width = width.max(3); let height = height.max(3);
        let origin = Pos::new(self.player.x - (width as i32 / 2), self.player.y - (height as i32 / 2));
        let visibility_radius = if self.night { 3 } else { (width.max(height) as i32 / 2).max(1) };
        let mut nearby = Vec::with_capacity((width * height) as usize);
        for y in origin.y..origin.y + height as i32 { for x in origin.x..origin.x + width as i32 { let pos = Pos::new(x, y); let visible = pos.distance(self.player) <= visibility_radius || self.torch_lights(pos); nearby.push((pos, if visible && self.line_of_sight(pos) { self.block_at(pos) } else { Block::Unknown })); } }
        let monsters = self.monsters.iter().copied().filter(|pos| self.visible(*pos, visibility_radius)).collect::<Vec<_>>();
        let mut sounds = Vec::new();
        if self.monsters.iter().any(|pos| pos.distance(self.player) <= visibility_radius + 3 && !self.visible(*pos, visibility_radius)) { sounds.push("你听见远处有脚步声。".into()); }
        if self.night && !self.torch_lights(self.player) { sounds.push("黑暗正在靠近。".into()); }
        Observation { tick: self.tick, origin, width, height, self_pos: self.player, hp: self.hp, night: self.night, inventory: self.inventory.clone(), nearby, monsters, sounds, sheltered: self.is_sheltered(), torch_lit: self.torch_lights(self.player) }
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
    fn is_sheltered(&self) -> bool {
        const SEARCH_RADIUS: i32 = 6;
        let min_x = self.player.x - SEARCH_RADIUS;
        let max_x = self.player.x + SEARCH_RADIUS;
        let min_y = self.player.y - SEARCH_RADIUS;
        let max_y = self.player.y + SEARCH_RADIUS;
        let mut queue = VecDeque::from([self.player]);
        let mut visited = HashMap::from([(self.player, true)]);
        while let Some(pos) = queue.pop_front() {
            if pos.x == min_x || pos.x == max_x || pos.y == min_y || pos.y == max_y { return false; }
            for next in [Pos::new(pos.x - 1, pos.y), Pos::new(pos.x + 1, pos.y), Pos::new(pos.x, pos.y - 1), Pos::new(pos.x, pos.y + 1)] {
                if next.x < min_x || next.x > max_x || next.y < min_y || next.y > max_y || visited.contains_key(&next) { continue; }
                if !matches!(self.block_at(next), Block::Wall | Block::StoneWall | Block::PlacedDirt) {
                    visited.insert(next, true);
                    queue.push_back(next);
                }
            }
        }
        true
    }
    fn line_of_sight(&self, pos: Pos) -> bool { self.line_of_sight_from(self.player, pos) }
    fn blocks_sight(block: Block) -> bool { matches!(block, Block::Tree | Block::Stone | Block::StoneWall | Block::Dirt | Block::PlacedDirt | Block::Wall) }
    fn line_of_sight_from(&self, from: Pos, to: Pos) -> bool {
        let steps = (to.x - from.x).abs().max((to.y - from.y).abs());
        if steps <= 1 { return true; }
        for step in 1..steps { let x = from.x + (to.x - from.x) * step / steps; let y = from.y + (to.y - from.y) * step / steps; if Self::blocks_sight(self.block_at(Pos::new(x, y))) { return false; } }
        true
    }
    fn player_has_torch(&self) -> bool { self.torch_lights(self.player) }
    fn monster_can_see_player(&self, monster: Pos) -> bool { monster.distance(self.player) <= 8 && self.line_of_sight_from(monster, self.player) }
    fn monster_step(&self, monster: Pos, fleeing: bool) -> Option<Pos> {
        let options = [Pos::new(monster.x - 1, monster.y), Pos::new(monster.x + 1, monster.y), Pos::new(monster.x, monster.y - 1), Pos::new(monster.x, monster.y + 1)]
            .into_iter().filter(|pos| Self::walkable(self.block_at(*pos)) && !self.monsters.iter().any(|other| *other == *pos));
        options.min_by_key(|pos| { let distance = pos.distance(self.player); if fleeing { -distance } else { distance } })
    }
    fn monster_turn(&mut self) {
        let current = self.monsters.clone();
        for (index, monster) in current.into_iter().enumerate() {
            if !self.monster_can_see_player(monster) { continue; }
            if monster.distance(self.player) == 1 {
                if self.player_has_torch() { self.events.push(WorldEvent::MonsterRepelled { pos: monster }); continue; }
                self.hp = self.hp.saturating_sub(1);
                self.events.push(WorldEvent::PlayerHurt { hp: self.hp });
                continue;
            }
            let fleeing = self.player_has_torch();
            let Some(next) = self.monster_step(monster, fleeing) else { continue };
            self.monsters[index] = next;
            self.events.push(if fleeing { WorldEvent::MonsterRepelled { pos: next } } else { WorldEvent::MonsterMoved { from: monster, to: next } });
        }
    }
    fn adjacent(&self, direction: Direction) -> Pos { let (x, y) = direction.offset(); Pos::new(self.player.x + x, self.player.y + y) }
    fn move_player(&mut self, direction: Direction) {
        let next = self.adjacent(direction);
        if !Self::walkable(self.block_at(next)) { self.events.push(WorldEvent::Message("那里被资源挡住了，先挖开再走。".into())); return; }
        let from = self.player; self.player = next; self.events.push(WorldEvent::Moved { from, to: next });
        if self.night && self.monsters.iter().any(|monster| monster.distance(self.player) == 1) && !self.player_has_torch() { self.hp = self.hp.saturating_sub(1); self.events.push(WorldEvent::PlayerHurt { hp: self.hp }); }
    }
    fn break_at(&mut self, target: Pos) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        let block = self.block_at(target);
        if matches!(block, Block::Wall | Block::StoneWall | Block::PlacedDirt) { self.events.push(WorldEvent::Message("这是建造结构，不能用挖掘模式破坏。".into())); return; }
        let gain = match block { Block::Tree => Some((PlaceBlock::WoodWall, 2)), Block::Stone => Some((PlaceBlock::Stone, 1)), Block::Dirt => Some((PlaceBlock::Dirt, 2)), Block::Torch => Some((PlaceBlock::Torch, 1)), _ => None };
        let Some((item, amount)) = gain else { self.events.push(WorldEvent::Message("这块方块没有可以采集的材料。".into())); return };
        self.set_block(target, Block::Grass); self.add_item(item, amount); self.events.push(WorldEvent::BlockBroken { pos: target, block }); self.events.push(WorldEvent::ItemCollected { item, amount });
    }
    fn place_at(&mut self, target: Pos, item: PlaceBlock) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        if !matches!(self.block_at(target), Block::Grass | Block::Dirt) { self.events.push(WorldEvent::Message("这里只能在草地或泥土上放置。".into())); return; }
        if !self.remove_item(item) { self.events.push(WorldEvent::Message("你的材料不够。".into())); return; }
        let block = match item { PlaceBlock::WoodWall => Block::Wall, PlaceBlock::Stone => Block::StoneWall, PlaceBlock::Dirt => Block::PlacedDirt, PlaceBlock::Torch => Block::Torch };
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
    #[test] fn dirt_can_hold_a_new_block() { let mut world = World::new(20, 12); world.set_block(Pos::new(10, 6), Block::Dirt); world.apply(PlayerCommand::PlaceAt(Pos::new(10, 6), PlaceBlock::Torch)); assert_eq!(world.snapshot().modified.iter().find(|(pos, _)| *pos == Pos::new(10, 6)).unwrap().1, Block::Torch); }
    #[test] fn placed_stone_is_distinct_from_natural_stone() { let mut world = World::new(20, 12); world.apply(PlayerCommand::PlaceAt(Pos::new(10, 6), PlaceBlock::Stone)); assert_eq!(world.snapshot().modified.iter().find(|(pos, _)| *pos == Pos::new(10, 6)).unwrap().1, Block::StoneWall); }
    #[test] fn placed_dirt_is_distinct_from_natural_dirt() { let mut world = World::new(20, 12); world.apply(PlayerCommand::PlaceAt(Pos::new(10, 6), PlaceBlock::Dirt)); assert_eq!(world.snapshot().modified.iter().find(|(pos, _)| *pos == Pos::new(10, 6)).unwrap().1, Block::PlacedDirt); }
    #[test] fn mining_mode_cannot_destroy_constructed_structures() { let mut world = World::new(20, 12); world.apply(PlayerCommand::PlaceAt(Pos::new(10, 6), PlaceBlock::Stone)); world.drain_events(); world.apply(PlayerCommand::BreakAt(Pos::new(10, 6))); assert_eq!(world.snapshot().modified.iter().find(|(pos, _)| *pos == Pos::new(10, 6)).unwrap().1, Block::StoneWall); assert!(world.drain_events().iter().any(|event| matches!(event, WorldEvent::Message(message) if message.contains("建造结构")))); }
    #[test] fn enclosed_walls_protect_from_monsters() { let mut world = World::new(20, 12); for pos in [Pos::new(8, 5), Pos::new(9, 5), Pos::new(10, 5), Pos::new(8, 6), Pos::new(10, 6), Pos::new(8, 7), Pos::new(9, 7), Pos::new(10, 7)] { world.set_block(pos, Block::Wall); } world.monsters.push(Pos::new(7, 6)); world.tick = 16; world.night = true; world.tick(); assert_eq!(world.snapshot().hp, MAX_HP); }
    #[test] fn torch_repels_monsters_without_a_shelter() { let mut world = World::new(20, 12); world.set_block(Pos::new(9, 6), Block::Torch); world.monsters.push(Pos::new(10, 6)); world.tick = 16; world.night = true; world.tick(); assert_eq!(world.snapshot().hp, MAX_HP); }
    #[test] fn visible_monster_moves_toward_player_at_night() { let mut world = World::new(20, 12); world.inventory.torch = 0; world.monsters.push(Pos::new(12, 6)); world.tick = 16; world.night = true; world.tick(); assert_eq!(world.snapshot().monsters, vec![Pos::new(11, 6)]); }
    #[test] fn monster_attack_happens_when_player_moves_next_to_it() { let mut world = World::new(20, 12); world.inventory.torch = 0; world.monsters.push(Pos::new(11, 6)); world.tick = 16; world.night = true; world.apply(PlayerCommand::Move(Direction::Right)); assert_eq!(world.snapshot().hp, MAX_HP - 1); }
    #[test] fn opaque_block_hides_player_from_monster() { let mut world = World::new(20, 12); world.inventory.torch = 0; world.set_block(Pos::new(10, 6), Block::Wall); world.monsters.push(Pos::new(11, 6)); world.tick = 16; world.night = true; world.tick(); assert_eq!(world.snapshot().monsters, vec![Pos::new(11, 6)]); assert_eq!(world.snapshot().hp, MAX_HP); }
}
