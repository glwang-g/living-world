//! Restricted agent contract. Bots receive an observation and return one intent;
//! the core remains the only authority that can change the world.

use world_protocol::{Direction, Intent, Observation};

pub trait Bot: Send {
    fn decide(&mut self, observation: &Observation) -> Intent;
}

#[derive(Default)]
pub struct WanderBot;

impl Bot for WanderBot {
    fn decide(&mut self, observation: &Observation) -> Intent {
        if observation.night { Intent::Wait } else { Intent::Move(Direction::Right) }
    }
}
