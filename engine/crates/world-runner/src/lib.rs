//! Long-running world orchestration. A future HTTP/WebSocket server should own
//! this runner; the browser should only receive snapshots and send commands.

use world_bot::Bot;
use world_core::World;
use world_protocol::{Intent, PlayerCommand, WorldEvent, WorldSnapshot};

pub struct WorldRunner {
    pub world: World,
    bot: Option<Box<dyn Bot>>,
}

impl WorldRunner {
    pub fn new(width: u32, height: u32) -> Self { Self { world: World::new(width, height), bot: None } }
    pub fn from_world(world: World) -> Self { Self { world, bot: None } }
    pub fn with_bot(mut self, bot: Box<dyn Bot>) -> Self { self.bot = Some(bot); self }
    pub fn command(&mut self, command: PlayerCommand) { self.world.apply(command); }
    pub fn step(&mut self) -> (WorldSnapshot, Vec<WorldEvent>) {
        if let Some(bot) = &mut self.bot {
            let intent = bot.decide(&self.world.observation(1));
            self.world.apply(match intent { Intent::Move(direction) => PlayerCommand::Move(direction), Intent::Break => PlayerCommand::BreakAt(self.world.snapshot().player), Intent::Place(block) => PlayerCommand::PlaceAt(self.world.snapshot().player, block), Intent::Wait => PlayerCommand::Wait });
        }
        self.world.tick();
        (self.world.snapshot(), self.world.drain_events())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use world_bot::WanderBot;
    #[test] fn runner_advances_without_a_client() { let mut runner = WorldRunner::new(20, 12).with_bot(Box::new(WanderBot)); let (snapshot, _) = runner.step(); assert_eq!(snapshot.tick, 7); }
}
