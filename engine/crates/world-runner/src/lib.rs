//! Long-running world orchestration. A future HTTP/WebSocket server should own
//! this runner; the browser should only receive snapshots and send commands.

use world_bot::Bot;
use world_core::World;
use world_protocol::{Intent, PlayerCommand, WorldEvent, WorldSnapshot};

/// Teaching-facing projection from native world facts to the shared Freexlib
/// Rule Mission shape. This belongs in the runner: the core keeps its native,
/// compact event enum and remains independent of teaching or UI concerns.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuleMissionEvent {
    pub tick: u64,
    pub actor: String,
    pub action: String,
    pub facts: Vec<String>,
    pub consequences: Vec<String>,
    pub visible_to: Vec<String>,
}

pub fn project_rule_mission_event(tick: u64, event: &WorldEvent) -> RuleMissionEvent {
    let (actor, action, facts, consequences) = match event {
        WorldEvent::SignalChanged { pos, powered } => ("learner", "toggle_switch", vec![format!("switch at ({},{}) is {}", pos.x, pos.y, if *powered { "on" } else { "off" })], vec!["signal propagation resolved".into()]),
        WorldEvent::DoorChanged { pos, open } => ("world", "resolve_signal", vec![format!("door at ({},{}) received a signal", pos.x, pos.y)], vec![format!("door {}", if *open { "opened" } else { "closed" })]),
        WorldEvent::Moved { from, to } => ("learner", "move", vec![format!("moved ({},{}) -> ({},{})", from.x, from.y, to.x, to.y)], vec!["new local observation".into()]),
        WorldEvent::BlockBroken { pos, .. } => ("learner", "break", vec![format!("broke block at ({},{})", pos.x, pos.y)], vec!["world terrain changed".into()]),
        WorldEvent::BlockPlaced { pos, .. } => ("learner", "place", vec![format!("placed block at ({},{})", pos.x, pos.y)], vec!["world terrain changed".into()]),
        WorldEvent::ItemCollected { amount, .. } => ("learner", "collect", vec![format!("collected {} item(s)", amount)], vec!["inventory increased".into()]),
        WorldEvent::NightStarted => ("world", "advance_time", vec!["night started".into()], vec!["visibility and threats changed".into()]),
        WorldEvent::Dawn => ("world", "advance_time", vec!["dawn started".into()], vec!["visibility changed".into()]),
        WorldEvent::Message(message) => ("world", "message", vec![message.clone()], vec![]),
        _ => ("world", "resolve_world", vec![format!("native event: {event:?}")], vec!["world state advanced".into()]),
    };
    RuleMissionEvent { tick, actor: actor.into(), action: action.into(), facts, consequences, visible_to: vec!["learner".into(), "history".into()] }
}

pub struct WorldRunner {
    pub world: World,
    bot: Option<Box<dyn Bot>>,
}

impl WorldRunner {
    pub fn new(width: u32, height: u32) -> Self { Self { world: World::new(width, height), bot: None } }
    pub fn from_world(world: World) -> Self { Self { world, bot: None } }
    pub fn with_bot(mut self, bot: Box<dyn Bot>) -> Self { self.bot = Some(bot); self }
    pub fn command(&mut self, command: PlayerCommand) { self.world.apply(command); }
    pub fn danger_step(&mut self) -> Vec<WorldEvent> { self.world.danger_tick(); self.world.drain_events() }
    pub fn step(&mut self) -> (WorldSnapshot, Vec<WorldEvent>) {
        if let Some(bot) = &mut self.bot {
            let intent = bot.decide(&self.world.observation(1));
            self.world.apply(match intent { Intent::Move(direction) => PlayerCommand::Move(direction), Intent::BreakAt(pos) => PlayerCommand::BreakAt(pos), Intent::PlaceAt(pos, block) => PlayerCommand::PlaceAt(pos, block), Intent::Toggle(pos) => PlayerCommand::ToggleAt(pos), Intent::Wait => PlayerCommand::Wait });
        }
        self.world.tick();
        (self.world.snapshot(), self.world.drain_events())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use world_bot::{Bot, WanderBot};
    use world_protocol::{Block, PlaceBlock, Pos};

    struct ToggleBot;
    impl Bot for ToggleBot {
        fn decide(&mut self, observation: &world_protocol::Observation) -> Intent {
            Intent::Toggle(Pos::new(observation.self_pos.x + 1, observation.self_pos.y))
        }
    }

    struct PlaceBot;
    impl Bot for PlaceBot {
        fn decide(&mut self, observation: &world_protocol::Observation) -> Intent {
            Intent::PlaceAt(Pos::new(observation.self_pos.x + 1, observation.self_pos.y), PlaceBlock::WoodWall)
        }
    }

    #[test] fn runner_advances_without_a_client() { let mut runner = WorldRunner::new(20, 12).with_bot(Box::new(WanderBot)); let (snapshot, _) = runner.step(); assert_eq!(snapshot.tick, 7); }
    #[test] fn bot_can_toggle_an_observed_switch() {
        let mut world = World::new(20, 12);
        let player = world.snapshot().player;
        world.apply(PlayerCommand::PlaceAt(Pos::new(player.x + 1, player.y), PlaceBlock::Switch));
        let mut runner = WorldRunner::from_world(world).with_bot(Box::new(ToggleBot));
        let (snapshot, events) = runner.step();
        assert!(events.iter().any(|event| matches!(event, WorldEvent::SignalChanged { powered: true, .. })));
        assert!(snapshot.modified.iter().any(|(_, block)| *block == Block::SwitchOn));
    }
    #[test] fn bot_can_place_an_adjacent_structure_without_occupying_its_own_cell() {
        let world = World::new(20, 12);
        let player = world.snapshot().player;
        let mut runner = WorldRunner::from_world(world).with_bot(Box::new(PlaceBot));
        let (snapshot, events) = runner.step();
        assert_eq!(snapshot.player, player);
        assert!(events.iter().any(|event| matches!(event, WorldEvent::BlockPlaced { pos, block: Block::Wall } if *pos == Pos::new(player.x + 1, player.y))));
    }
    #[test] fn signal_and_door_events_project_to_the_shared_rule_mission_shape() {
        let signal = project_rule_mission_event(9, &WorldEvent::SignalChanged { pos: Pos::new(3, 4), powered: true });
        assert_eq!(signal.action, "toggle_switch");
        assert_eq!(signal.facts, vec!["switch at (3,4) is on"]);
        assert_eq!(signal.visible_to, vec!["learner", "history"]);
        let door = project_rule_mission_event(9, &WorldEvent::DoorChanged { pos: Pos::new(5, 4), open: true });
        assert_eq!(door.consequences, vec!["door opened"]);
    }
}
