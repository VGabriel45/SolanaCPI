use anchor_lang::prelude::*;

declare_id!("3pQ97qmmc4ifb75ZCUvXwk9Q7DtSuymzKknd7CnroLD1");

pub mod instructions;
use instructions::*;
#[program]
pub mod orcacpi {
    use super::*;

    pub fn proxy_swap(
        ctx: Context<WhirlpoolSwap>,
        amount: u64,
        other_amount_threshold: u64,
        sqrt_price_limit: u128,
        amount_specified_is_input: bool,
        a_to_b: bool,
      ) -> Result<()> {
        return instructions::whirlpool_swap::handler(
          ctx,
          amount,
          other_amount_threshold,
          sqrt_price_limit,
          amount_specified_is_input,
          a_to_b,
        );
      }
}

