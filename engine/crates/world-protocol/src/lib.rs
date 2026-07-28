//! Stable messages shared by the authoritative world and its clients.
//! This crate must stay renderer- and storage-independent.

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Pos {
    pub x: i32,
    pub y: i32,
}

impl Pos {
    pub const fn new(x: i32, y: i32) -> Self { Self { x, y } }
    pub fn distance(self, other: Self) -> i32 { (self.x - other.x).abs() + (self.y - other.y).abs() }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction { Up, Down, Left, Right }

impl Direction {
    pub fn offset(self) -> (i32, i32) {
        match self { Self::Up => (0, -1), Self::Down => (0, 1), Self::Left => (-1, 0), Self::Right => (1, 0) }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Block { Grass, Tree, Stone, Water, Dirt, Wall, Torch, Unknown }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlaceBlock { WoodWall, Stone, Dirt, Torch }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayerCommand { Move(Direction), BreakAt(Pos), PlaceAt(Pos, PlaceBlock), Wait, Reset }

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Intent { Move(Direction), Break, Place(PlaceBlock), Wait }

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorldEvent {
    Moved { from: Pos, to: Pos },
    BlockBroken { pos: Pos, block: Block },
    BlockPlaced { pos: Pos, block: Block },
    ItemCollected { item: PlaceBlock, amount: u8 },
    NightStarted,
    Dawn,
    MonsterSpawned { pos: Pos },
    PlayerHurt { hp: u8 },
    Message(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventRecord {
    pub tick: u64,
    pub actor: String,
    pub kind: String,
    pub location: Option<Pos>,
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Inventory {
    pub wood: u32,
    pub stone: u32,
    pub dirt: u32,
    pub torch: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldSnapshot {
    pub tick: u64,
    pub player: Pos,
    pub hp: u8,
    pub inventory: Inventory,
    pub monsters: Vec<Pos>,
    pub night: bool,
    pub modified: Vec<(Pos, Block)>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub tick: u64,
    pub origin: Pos,
    pub width: u32,
    pub height: u32,
    pub self_pos: Pos,
    pub hp: u8,
    pub night: bool,
    pub inventory: Inventory,
    pub nearby: Vec<(Pos, Block)>,
    pub monsters: Vec<Pos>,
    pub sounds: Vec<String>,
}
