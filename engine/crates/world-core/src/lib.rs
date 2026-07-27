//! The authoritative, deterministic world rules. No renderer, HTTP server,
//! database, or bot implementation belongs in this crate.

use world_protocol::{Block, Direction, Inventory, Observation, PlaceBlock, PlayerCommand, Pos, WorldEvent, WorldSnapshot};

const MAX_HP: u8 = 5;

pub struct World {
    tick: u64,
    width: u32,
    height: u32,
    blocks: Vec<Block>,
    player: Pos,
    hp: u8,
    inventory: Inventory,
    monsters: Vec<Pos>,
    night: bool,
    events: Vec<WorldEvent>,
}

impl World {
    pub fn new(width: u32, height: u32) -> Self {
        let mut blocks = Vec::with_capacity((width * height) as usize);
        for y in 0..height as i32 {
            for x in 0..width as i32 {
                let block = if x == 0 || y == 0 || x == width as i32 - 1 || y == height as i32 - 1 { Block::Water }
                    else if (x * 11 + y * 7) % 23 == 0 || (x == 4 && y > 2 && y < 8) { Block::Tree }
                    else if (x * 5 + y * 13) % 29 == 0 { Block::Stone }
                    else if (x * 3 + y * 5) % 17 == 0 { Block::Dirt }
                    else { Block::Grass };
                blocks.push(block);
            }
        }
        // Tick 6 corresponds to 05:00: a new world opens in daylight.
        Self { tick: 6, width, height, blocks, player: Pos::new(9, 6), hp: MAX_HP, inventory: Inventory { wood: 6, stone: 3, dirt: 12, torch: 4 }, monsters: Vec::new(), night: false, events: Vec::new() }
    }

    pub fn from_snapshot(snapshot: WorldSnapshot) -> Self {
        Self { tick: snapshot.tick, width: snapshot.width, height: snapshot.height, blocks: snapshot.blocks, player: snapshot.player, hp: snapshot.hp, inventory: snapshot.inventory, monsters: snapshot.monsters, night: snapshot.night, events: Vec::new() }
    }

    pub fn tick(&mut self) {
        self.tick += 1;
        let hour = (self.tick - 1) % 24;
        let night = hour >= 16 || hour < 5;
        if night != self.night {
            self.night = night;
            self.events.push(if night { WorldEvent::NightStarted } else { WorldEvent::Dawn });
            if night && self.monsters.is_empty() { let pos = Pos::new(3, 3); self.monsters.push(pos); self.events.push(WorldEvent::MonsterSpawned { pos }); }
            if !night { self.monsters.clear(); }
        }
        if self.night && self.monsters.iter().any(|monster| monster.distance(self.player) == 1) {
            self.hp = self.hp.saturating_sub(1);
            self.events.push(WorldEvent::PlayerHurt { hp: self.hp });
        }
    }

    pub fn apply(&mut self, command: PlayerCommand) {
        match command { PlayerCommand::Move(direction) => self.move_player(direction), PlayerCommand::BreakAt(pos) => self.break_at(pos), PlayerCommand::PlaceAt(pos, block) => self.place_at(pos, block), PlayerCommand::Wait => self.events.push(WorldEvent::Message("你等待了一回合。".into())), PlayerCommand::Reset => { let width = self.width; let height = self.height; *self = Self::new(width, height); self.events.push(WorldEvent::Message("世界重新开始了。".into())); } }
    }

    pub fn snapshot(&self) -> WorldSnapshot { WorldSnapshot { tick: self.tick, width: self.width, height: self.height, blocks: self.blocks.clone(), player: self.player, hp: self.hp, inventory: self.inventory.clone(), monsters: self.monsters.clone(), night: self.night } }
    pub fn observation(&self) -> Observation {
        let mut nearby = Vec::new();
        for y in (self.player.y - 1)..=(self.player.y + 1) { for x in (self.player.x - 1)..=(self.player.x + 1) { if let Some(block) = self.block_at(Pos::new(x, y)) { nearby.push((Pos::new(x, y), block)); } } }
        Observation { tick: self.tick, self_pos: self.player, night: self.night, inventory: self.inventory.clone(), nearby }
    }
    pub fn drain_events(&mut self) -> Vec<WorldEvent> { std::mem::take(&mut self.events) }

    fn block_at(&self, pos: Pos) -> Option<Block> { if self.in_bounds(pos) { Some(self.blocks[self.index(pos)]) } else { None } }
    fn set_block(&mut self, pos: Pos, block: Block) { let index = self.index(pos); self.blocks[index] = block; }
    fn in_bounds(&self, pos: Pos) -> bool { pos.x >= 0 && pos.y >= 0 && pos.x < self.width as i32 && pos.y < self.height as i32 }
    fn index(&self, pos: Pos) -> usize { (pos.y as u32 * self.width + pos.x as u32) as usize }
    fn adjacent(&self, direction: Direction) -> Pos { let (x, y) = direction.offset(); Pos::new(self.player.x + x, self.player.y + y) }
    fn move_player(&mut self, direction: Direction) {
        let next = self.adjacent(direction);
        if !self.in_bounds(next) || matches!(self.block_at(next), Some(Block::Water | Block::Wall)) { self.events.push(WorldEvent::Message("那里过不去。".into())); return; }
        let from = self.player; self.player = next; self.events.push(WorldEvent::Moved { from, to: next });
    }
    fn break_at(&mut self, target: Pos) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        let Some(block) = self.block_at(target) else { return };
        let gain = match block { Block::Tree => Some((PlaceBlock::WoodWall, 2)), Block::Stone => Some((PlaceBlock::Stone, 1)), Block::Dirt => Some((PlaceBlock::Dirt, 2)), Block::Wall => Some((PlaceBlock::WoodWall, 1)), Block::Torch => Some((PlaceBlock::Torch, 1)), _ => None };
        let Some((item, amount)) = gain else { self.events.push(WorldEvent::Message("这块方块没有可以采集的材料。".into())); return };
        self.set_block(target, Block::Grass); self.add_item(item, amount); self.events.push(WorldEvent::BlockBroken { pos: target, block }); self.events.push(WorldEvent::ItemCollected { item, amount });
    }
    fn place_at(&mut self, target: Pos, item: PlaceBlock) {
        if self.player.distance(target) > 1 { self.events.push(WorldEvent::Message("你够不到那里。".into())); return; }
        if self.block_at(target) != Some(Block::Grass) { self.events.push(WorldEvent::Message("这里只能在草地上放置。".into())); return; }
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
    #[test] fn movement_changes_position() { let mut world = World::new(20, 12); world.apply(PlayerCommand::Move(Direction::Up)); assert_eq!(world.snapshot().player, Pos::new(9, 5)); }
}
