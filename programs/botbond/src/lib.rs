use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EG9rKPV69v3WNX7aVchAPonMtKPp6yML7jZwDjMKaRKR");

/// docs/03-contracts.md §5의 계약을 그대로 구현한다.
/// 불변식: 범위 밖 호출 차단은 체인 정산 사유가 아니고, penalty <= max_penalty <= bond_amount,
/// policy hash는 open 이후 불변, 동일 세션 이중 정산 금지.
pub const GRACE_PERIOD_SECONDS: i64 = 30;

pub const STATUS_OPEN: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;
pub const STATUS_VIOLATED: u8 = 3;
pub const STATUS_RECLAIMED: u8 = 4;

#[program]
pub mod botbond {
    use super::*;

    pub fn open_bond(
        ctx: Context<OpenBond>,
        policy_hash: [u8; 32],
        session_nonce: u64,
        bond_amount: u64,
        max_penalty: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(bond_amount > 0, BotBondError::ZeroBond);
        require!(max_penalty <= bond_amount, BotBondError::MaxPenaltyExceedsBond);
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, BotBondError::ExpiryInPast);

        let bond = &mut ctx.accounts.bond_session;
        bond.agent = ctx.accounts.agent.key();
        bond.merchant = ctx.accounts.merchant.key();
        bond.settlement_authority = ctx.accounts.settlement_authority.key();
        bond.mint = ctx.accounts.mint.key();
        bond.policy_hash = policy_hash;
        bond.receipt_hash = [0u8; 32];
        bond.bond_amount = bond_amount;
        bond.max_penalty = max_penalty;
        bond.settled_penalty = 0;
        bond.expires_at = expires_at;
        bond.session_nonce = session_nonce;
        bond.status = STATUS_OPEN;
        bond.bump = ctx.bumps.bond_session;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.agent_token.to_account_info(),
                    to: ctx.accounts.escrow_token.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            bond_amount,
        )?;

        emit!(BondOpened {
            session: bond.key(),
            agent: bond.agent,
            merchant: bond.merchant,
            policy_hash,
            bond_amount,
            max_penalty,
            expires_at,
        });
        Ok(())
    }

    /// 정상 종료: reservation이 없거나 release/consume된 세션. penalty는 항상 0, 전액 환불.
    pub fn close_valid(ctx: Context<Settle>, receipt_hash: [u8; 32]) -> Result<()> {
        let bond = &ctx.accounts.bond_session;
        require!(bond.status == STATUS_OPEN, BotBondError::AlreadySettled);

        transfer_from_escrow(&ctx, ctx.accounts.escrow_token.amount, true)?;

        let bond = &mut ctx.accounts.bond_session;
        bond.receipt_hash = receipt_hash;
        bond.status = STATUS_CLOSED;

        emit!(BondRefunded {
            session: bond.key(),
            receipt_hash,
            refunded: bond.bond_amount,
        });
        Ok(())
    }

    /// 객관적 의무 위반(만료된 reservation) 정산. penalty <= max_penalty 강제, 나머지 환불.
    pub fn settle_violation(
        ctx: Context<SettleViolation>,
        receipt_hash: [u8; 32],
        penalty: u64,
    ) -> Result<()> {
        let bond = &ctx.accounts.bond_session;
        require!(bond.status == STATUS_OPEN, BotBondError::AlreadySettled);
        require!(penalty <= bond.max_penalty, BotBondError::PenaltyExceedsMax);

        let escrow_amount = ctx.accounts.escrow_token.amount;
        let refund = escrow_amount
            .checked_sub(penalty)
            .ok_or(BotBondError::PenaltyExceedsMax)?;

        let signer_seeds = bond_signer_seeds(&ctx.accounts.bond_session);
        let seeds_slices: Vec<&[u8]> = signer_seeds.iter().map(|s| s.as_slice()).collect();
        let signer: &[&[&[u8]]] = &[&seeds_slices];

        if penalty > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_token.to_account_info(),
                        to: ctx.accounts.merchant_token.to_account_info(),
                        authority: ctx.accounts.bond_session.to_account_info(),
                    },
                    signer,
                ),
                penalty,
            )?;
        }
        if refund > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_token.to_account_info(),
                        to: ctx.accounts.agent_token.to_account_info(),
                        authority: ctx.accounts.bond_session.to_account_info(),
                    },
                    signer,
                ),
                refund,
            )?;
        }

        let bond = &mut ctx.accounts.bond_session;
        bond.receipt_hash = receipt_hash;
        bond.settled_penalty = penalty;
        bond.status = STATUS_VIOLATED;

        emit!(ViolationSettled {
            session: bond.key(),
            receipt_hash,
            penalty,
            refunded: refund,
        });
        Ok(())
    }

    /// expiry + grace period 이후 agent가 직접 회수. settlement authority가 사라져도 자금이 잠기지 않는다.
    pub fn reclaim_expired(ctx: Context<Reclaim>) -> Result<()> {
        let bond = &ctx.accounts.bond_session;
        require!(bond.status == STATUS_OPEN, BotBondError::AlreadySettled);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > bond.expires_at + GRACE_PERIOD_SECONDS,
            BotBondError::NotYetReclaimable
        );

        let amount = ctx.accounts.escrow_token.amount;
        let signer_seeds = bond_signer_seeds(&ctx.accounts.bond_session);
        let seeds_slices: Vec<&[u8]> = signer_seeds.iter().map(|s| s.as_slice()).collect();
        let signer: &[&[&[u8]]] = &[&seeds_slices];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_token.to_account_info(),
                    to: ctx.accounts.agent_token.to_account_info(),
                    authority: ctx.accounts.bond_session.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        let bond = &mut ctx.accounts.bond_session;
        bond.status = STATUS_RECLAIMED;

        emit!(BondReclaimed {
            session: bond.key(),
            amount,
        });
        Ok(())
    }
}

fn bond_signer_seeds(bond: &Account<BondSession>) -> [Vec<u8>; 5] {
    [
        b"bond".to_vec(),
        bond.agent.to_bytes().to_vec(),
        bond.policy_hash.to_vec(),
        bond.session_nonce.to_le_bytes().to_vec(),
        vec![bond.bump],
    ]
}

fn transfer_from_escrow(ctx: &Context<Settle>, amount: u64, to_agent: bool) -> Result<()> {
    let bond = &ctx.accounts.bond_session;
    let seeds = bond_signer_seeds(bond);
    let seeds_slices: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let signer: &[&[&[u8]]] = &[&seeds_slices];
    let destination = if to_agent {
        ctx.accounts.agent_token.to_account_info()
    } else {
        return err!(BotBondError::InvalidDestination);
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.escrow_token.to_account_info(),
                to: destination,
                authority: bond.to_account_info(),
            },
            signer,
        ),
        amount,
    )
}

#[account]
#[derive(InitSpace)]
pub struct BondSession {
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub settlement_authority: Pubkey,
    pub mint: Pubkey,
    pub policy_hash: [u8; 32],
    pub receipt_hash: [u8; 32],
    pub bond_amount: u64,
    pub max_penalty: u64,
    pub settled_penalty: u64,
    pub expires_at: i64,
    pub session_nonce: u64,
    pub status: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(policy_hash: [u8; 32], session_nonce: u64)]
pub struct OpenBond<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    /// CHECK: merchant는 정산 수취 주소로만 기록된다.
    pub merchant: UncheckedAccount<'info>,
    /// CHECK: 정산 서명 권한으로 기록만 한다 (MVP trust assumption — 발표에서 숨기지 않음).
    pub settlement_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = agent,
        space = 8 + BondSession::INIT_SPACE,
        seeds = [b"bond", agent.key().as_ref(), policy_hash.as_ref(), &session_nonce.to_le_bytes()],
        bump
    )]
    pub bond_session: Account<'info, BondSession>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = agent,
    )]
    pub agent_token: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = agent,
        associated_token::mint = mint,
        associated_token::authority = bond_session,
    )]
    pub escrow_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settlement_authority: Signer<'info>,
    #[account(
        mut,
        has_one = settlement_authority @ BotBondError::UnauthorizedSettlement,
        has_one = mint,
        seeds = [b"bond", bond_session.agent.as_ref(), bond_session.policy_hash.as_ref(), &bond_session.session_nonce.to_le_bytes()],
        bump = bond_session.bump,
    )]
    pub bond_session: Account<'info, BondSession>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bond_session,
    )]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = agent_token.owner == bond_session.agent @ BotBondError::InvalidDestination,
    )]
    pub agent_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleViolation<'info> {
    pub settlement_authority: Signer<'info>,
    #[account(
        mut,
        has_one = settlement_authority @ BotBondError::UnauthorizedSettlement,
        has_one = mint,
        seeds = [b"bond", bond_session.agent.as_ref(), bond_session.policy_hash.as_ref(), &bond_session.session_nonce.to_le_bytes()],
        bump = bond_session.bump,
    )]
    pub bond_session: Account<'info, BondSession>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bond_session,
    )]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = agent_token.owner == bond_session.agent @ BotBondError::InvalidDestination,
    )]
    pub agent_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = merchant_token.owner == bond_session.merchant @ BotBondError::InvalidDestination,
    )]
    pub merchant_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        has_one = agent @ BotBondError::UnauthorizedReclaim,
        has_one = mint,
        seeds = [b"bond", bond_session.agent.as_ref(), bond_session.policy_hash.as_ref(), &bond_session.session_nonce.to_le_bytes()],
        bump = bond_session.bump,
    )]
    pub bond_session: Account<'info, BondSession>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bond_session,
    )]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = agent_token.owner == bond_session.agent @ BotBondError::InvalidDestination,
    )]
    pub agent_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct BondOpened {
    pub session: Pubkey,
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub policy_hash: [u8; 32],
    pub bond_amount: u64,
    pub max_penalty: u64,
    pub expires_at: i64,
}

#[event]
pub struct BondRefunded {
    pub session: Pubkey,
    pub receipt_hash: [u8; 32],
    pub refunded: u64,
}

#[event]
pub struct ViolationSettled {
    pub session: Pubkey,
    pub receipt_hash: [u8; 32],
    pub penalty: u64,
    pub refunded: u64,
}

#[event]
pub struct BondReclaimed {
    pub session: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum BotBondError {
    #[msg("bond amount must be greater than zero")]
    ZeroBond,
    #[msg("max penalty cannot exceed bond amount")]
    MaxPenaltyExceedsBond,
    #[msg("expiry must be in the future")]
    ExpiryInPast,
    #[msg("penalty exceeds signed max penalty")]
    PenaltyExceedsMax,
    #[msg("session already settled")]
    AlreadySettled,
    #[msg("only the recorded settlement authority may settle")]
    UnauthorizedSettlement,
    #[msg("only the agent may reclaim")]
    UnauthorizedReclaim,
    #[msg("grace period has not elapsed")]
    NotYetReclaimable,
    #[msg("invalid transfer destination")]
    InvalidDestination,
}
