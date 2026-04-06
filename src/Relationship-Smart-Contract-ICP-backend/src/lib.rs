use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::time;
use std::cell::Cell;
use std::cell::RefCell;

thread_local! {
    static IS_ACCEPTED: Cell<bool> = Cell::new(false);
    static ACCEPTED_TIME: Cell<u64> = Cell::new(0);
    static ACCEPTED_BY: RefCell<Option<Principal>> = RefCell::new(None);
}

#[derive(CandidType, Deserialize)]
struct ProposalStatus {
    is_accepted: bool,
    accepted_time: u64,
    accepted_by: Option<Principal>,
}

#[ic_cdk::update]
fn accept_proposal() -> String {
    let caller = ic_cdk::api::msg_caller();

    if caller == Principal::anonymous() {
        return "You must log in with Internet Identity to accept this proposal. 🔐".to_string();
    }

    let already_accepted = IS_ACCEPTED.with(|cell| cell.get());
    if already_accepted {
        return "The proposal has already been accepted. 💖".to_string();
    }

    let now = time();
    IS_ACCEPTED.with(|cell| cell.set(true));
    ACCEPTED_TIME.with(|cell| cell.set(now));
    ACCEPTED_BY.with(|cell| *cell.borrow_mut() = Some(caller));

    "Proposal accepted! Our love is now forever recorded on the blockchain. 💍".to_string()
}

#[ic_cdk::query]
fn get_status() -> ProposalStatus {
    ProposalStatus {
        is_accepted: IS_ACCEPTED.with(|cell| cell.get()),
        accepted_time: ACCEPTED_TIME.with(|cell| cell.get()),
        accepted_by: ACCEPTED_BY.with(|cell| *cell.borrow()),
    }
}

ic_cdk::export_candid!();
