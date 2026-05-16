"""
Re-link CadenciaEscrow to CadenciaTBill v2.
Updates treasury_app_id to the new TBill App ID and confirms
treasury_address (orchestrator) is still set correctly.

Run: python scripts/relink_escrow.py
"""

import os
import base64
from pathlib import Path

from dotenv import load_dotenv
from algosdk import mnemonic, account
from algosdk.v2client import algod
from algosdk.abi import Method as ABIMethod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer, AccountTransactionSigner,
)

# ── Config ────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env")

ALGOD_SERVER  = os.getenv("ALGOD_SERVER", "https://testnet-api.algonode.cloud")
ALGOD_PORT    = os.getenv("ALGOD_PORT",   "443")
ALGOD_TOKEN   = os.getenv("ALGOD_TOKEN",  "")

DEPLOYER_MNEMONIC = os.getenv("DEPLOYER_MNEMONIC", "")
ORCHESTRATOR_MN   = os.getenv("ORCHESTRATOR_MNEMONIC", "")
PLATFORM_WALLET   = os.getenv("PLATFORM_WALLET_ADDRESS", "")
ESCROW_APP_ID     = int(os.getenv("ESCROW_APP_ID", "0"))
TBILL_APP_ID      = int(os.getenv("TBILL_APP_ID",  "0"))

# ── Helpers ───────────────────────────────────────────────────

def get_client():
    return algod.AlgodClient(ALGOD_TOKEN, f"{ALGOD_SERVER}:{ALGOD_PORT}")

def get_deployer():
    sk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    return sk, account.address_from_private_key(sk)

def get_orchestrator_addr():
    sk = mnemonic.to_private_key(ORCHESTRATOR_MN)
    return account.address_from_private_key(sk)

def wait_for_confirmation(client, tx_id, timeout=10):
    last_round = client.status()["last-round"]
    while timeout > 0:
        info = client.pending_transaction_info(tx_id)
        if info.get("confirmed-round", 0) > 0:
            return info
        client.status_after_block(last_round + 1)
        last_round += 1
        timeout -= 1
    raise Exception(f"Tx {tx_id} not confirmed")

def call_abi(client, sk, addr, app_id, method_sig, args):
    method = ABIMethod.from_signature(method_sig)
    signer  = AccountTransactionSigner(sk)
    atc     = AtomicTransactionComposer()
    sp      = client.suggested_params()
    sp.fee  = 2000
    sp.flat_fee = True
    atc.add_method_call(
        app_id=app_id, method=method, sender=addr,
        sp=sp, signer=signer, method_args=args,
    )
    result = atc.execute(client, 4)
    print(f"    {method.name}() confirmed @ round {result.confirmed_round}")
    return result

def read_global_state(client, app_id):
    state = client.application_info(app_id)["params"]["global-state"]  # type: ignore[index]
    decoded = {}
    for kv in state:
        key = base64.b64decode(kv["key"]).decode("utf-8", errors="ignore")
        val = kv["value"]
        decoded[key] = val.get("uint", 0) if val["type"] == 2 else base64.b64decode(val.get("bytes", ""))
    return decoded

# ── Main ─────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  CADENCIA ESCROW — RE-LINK TO TBILL v2")
    print("=" * 60)

    client = get_client()
    deployer_sk, deployer_addr = get_deployer()
    orch_addr = get_orchestrator_addr()

    print(f"\n  Escrow App:  {ESCROW_APP_ID}")
    print(f"  TBill App:   {TBILL_APP_ID}  (v2 — 7 tiers)")
    print(f"  Orchestrator:{orch_addr}")
    print(f"  Platform:    {PLATFORM_WALLET}")

    # ── Read current Escrow state ──────────────────────────────
    print("\n--- Current Escrow Global State ---")
    gs = read_global_state(client, ESCROW_APP_ID)
    current_treasury_id = gs.get("treasury_app_id", 0)
    print(f"  treasury_app_id:  {current_treasury_id}  (will update to {TBILL_APP_ID})")
    print(f"  paused:           {gs.get('paused', 0)}")

    # ── Step 1: Link Escrow → TBill v2 ─────────────────────────
    print("\n--- Step 1: set_treasury(tbill_app_id, orch_addr) ---")
    call_abi(client, deployer_sk, deployer_addr, ESCROW_APP_ID,
             "set_treasury(uint64,address)void",
             [TBILL_APP_ID, orch_addr])

    # ── Step 2: Set platform wallet ────────────────────────────
    print("\n--- Step 2: set_platform_wallet(platform_wallet) ---")
    call_abi(client, deployer_sk, deployer_addr, ESCROW_APP_ID,
             "set_platform_wallet(address)void",
             [PLATFORM_WALLET])

    # ── Verify ─────────────────────────────────────────────────
    print("\n--- Verifying New State ---")
    gs2 = read_global_state(client, ESCROW_APP_ID)
    print(f"  treasury_app_id: {gs2.get('treasury_app_id', 0)}")
    print(f"  paused:          {gs2.get('paused', 0)}")

    print("\n" + "=" * 60)
    print("  RE-LINK COMPLETE")
    print("=" * 60)
    print(f"\n  Escrow {ESCROW_APP_ID} -> TBill {TBILL_APP_ID}")
    print(f"  Authorized orchestrator: {orch_addr}")
    print(f"\n  Explorer:")
    print(f"    https://testnet.explorer.perawallet.app/application/{ESCROW_APP_ID}")
    print(f"\n  Next: Run the orchestrator")
    print(f"    cd orchestrator && npx ts-node src/index.ts")
    print("=" * 60)

if __name__ == "__main__":
    main()
