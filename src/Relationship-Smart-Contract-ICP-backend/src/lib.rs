use candid::{CandidType, Deserialize};
use ic_cdk::api::time;
use std::cell::Cell;

thread_local! {
    static IS_ACCEPTED: Cell<bool> = Cell::new(false);
    static ACCEPTED_TIME: Cell<u64> = Cell::new(0);
}

#[derive(CandidType, Deserialize)]
struct ProposalStatus {
    is_accepted: bool,
    accepted_time: u64,
}

#[ic_cdk::update]
fn accept_proposal() -> String {
    let already_accepted = IS_ACCEPTED.with(|cell| cell.get());
    if already_accepted {
        return "The proposal has already been accepted. 💖".to_string();
    }
    let now = time();
    IS_ACCEPTED.with(|cell| cell.set(true));
    ACCEPTED_TIME.with(|cell| cell.set(now));
    "Proposal accepted! Our love is now forever recorded on the blockchain. 💍".to_string()
}

#[ic_cdk::query]
fn get_status() -> ProposalStatus {
    ProposalStatus {
        is_accepted: IS_ACCEPTED.with(|cell| cell.get()),
        accepted_time: ACCEPTED_TIME.with(|cell| cell.get()),
    }
}
