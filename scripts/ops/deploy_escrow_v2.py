"""
Cadencia Treasury - CadenciaEscrow Redeployment Script
Deploys the updated Escrow contract (auto-complete allowed by orchestrator),
funds it, configures links, and updates .env.

Run: python scripts/deploy_escrow_v2.py
"""

import os
import sys
import base64
from pathlib import Path

from dotenv import load_dotenv
from algosdk import mnemonic, account, encoding
from algosdk.v2client import algod
from algosdk.transaction import (
    ApplicationCreateTxn, OnComplete, StateSchema, PaymentTxn,
)
from algosdk.abi import Method as ABIMethod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer, AccountTransactionSigner,
)

PROJECT_ROOT = Path(__file__).parent.parent
ENV_PATH     = PROJECT_ROOT / ".env"
ARTIFACT_DIR = PROJECT_ROOT / "smart_contracts" / "cadencia_escrow"

load_dotenv(ENV_PATH)

ALGOD_SERVER      = os.getenv("ALGOD_SERVER", "https://testnet-api.algonode.cloud")
ALGOD_PORT        = os.getenv("ALGOD_PORT",   "443")
ALGOD_TOKEN       = os.getenv("ALGOD_TOKEN",  "")
DEPLOYER_MNEMONIC = os.getenv("DEPLOYER_MNEMONIC", "")
ORCHESTRATOR_MN   = os.getenv("ORCHESTRATOR_MNEMONIC", "")
PLATFORM_WALLET   = os.getenv("PLATFORM_WALLET_ADDRESS", "")
TBILL_APP_ID      = int(os.getenv("TBILL_APP_ID", "0"))

# Global schema: admin, treasury_app_id, treasury_address, platform_wallet,
#   total_locked, total_released, total_orders, active_orders,
#   min_order_amount, default_lock_duration, paused = 9 uints + 2 bytes (admin, treasury_address/platform_wallet)
NUM_UINTS = 9
NUM_BYTES = 3

def get_client():
    return algod.AlgodClient(ALGOD_TOKEN, f"{ALGOD_SERVER}:{ALGOD_PORT}")

def get_deployer():
    sk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    return sk, account.address_from_private_key(sk)

def get_orchestrator_addr():
    sk = mnemonic.to_private_key(ORCHESTRATOR_MN)
    return account.address_from_private_key(sk)

def wait_confirmed(client, tx_id, timeout=12):
    last = client.status()["last-round"]
    for _ in range(timeout):
        info = client.pending_transaction_info(tx_id)
        if info.get("confirmed-round", 0) > 0:
            return info
        client.status_after_block(last + 1)
        last += 1
    raise Exception(f"Tx {tx_id} not confirmed")

def compile_teal(client, path: Path) -> bytes:
    return base64.b64decode(client.compile(path.read_text())["result"])

def call_abi(client, sk, addr, app_id, method_sig, args, fee=2000):
    method  = ABIMethod.from_signature(method_sig)
    signer  = AccountTransactionSigner(sk)
    atc     = AtomicTransactionComposer()
    sp      = client.suggested_params()
    sp.fee  = fee
    sp.flat_fee = True
    atc.add_method_call(
        app_id=app_id, method=method, sender=addr, sp=sp,
        signer=signer, method_args=args,
    )
    result = atc.execute(client, 4)
    print(f"    {method.name}() confirmed @ round {result.confirmed_round}")
    return result

def write_env(key, value):
    content = ENV_PATH.read_text()
    lines   = content.splitlines()
    updated = False
    new_lines = []
    for line in lines:
        if line.startswith(f"{key}="):
            new_lines.append(f"{key}={value}")
            updated = True
        else:
            new_lines.append(line)
    if not updated:
        new_lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(new_lines) + "\n")

def app_address(app_id: int) -> str:
    return encoding.encode_address(
        encoding.checksum(b"appID" + app_id.to_bytes(8, "big"))
    )

def main():
    print("=" * 60)
    print("  CADENCIA ESCROW v2 — REDEPLOYMENT")
    print("  (auto-complete by orchestrator enabled)")
    print("=" * 60)

    client = get_client()
    deployer_sk, deployer_addr = get_deployer()
    orch_addr = get_orchestrator_addr()

    bal = client.account_info(deployer_addr)["amount"] / 1e6  # type: ignore
    print(f"\n  Deployer:     {deployer_addr}  ({bal:.3f} ALGO)")
    print(f"  Orchestrator: {orch_addr}")
    print(f"  TBill App:    {TBILL_APP_ID}")
    print(f"  Platform:     {PLATFORM_WALLET}")

    if bal < 5:
        print("\n  [FAIL] Need at least 5 ALGO")
        sys.exit(1)

    # ── Step 1: Deploy ─────────────────────────────────────────
    print("\n--- Step 1: Deploy CadenciaEscrow v2 ---")
    approval = compile_teal(client, ARTIFACT_DIR / "CadenciaEscrow.approval.teal")
    clear    = compile_teal(client, ARTIFACT_DIR / "CadenciaEscrow.clear.teal")
    print(f"  Approval: {len(approval)} bytes  |  Clear: {len(clear)} bytes")

    sp = client.suggested_params()
    sp.fee = 1000
    sp.flat_fee = True
    txn = ApplicationCreateTxn(
        sender=deployer_addr, sp=sp, on_complete=OnComplete.NoOpOC,
        approval_program=approval, clear_program=clear,
        global_schema=StateSchema(num_uints=NUM_UINTS, num_byte_slices=NUM_BYTES),
        local_schema=StateSchema(num_uints=0, num_byte_slices=0),
    )
    result  = wait_confirmed(client, client.send_transaction(txn.sign(deployer_sk)))
    app_id  = result["application-index"]
    addr    = app_address(app_id)
    print(f"  App ID:  {app_id}")
    print(f"  Address: {addr}")

    # ── Step 2: Fund ───────────────────────────────────────────
    print("\n--- Step 2: Fund (2 ALGO for MBR) ---")
    sp = client.suggested_params()
    sp.fee = 1000
    sp.flat_fee = True
    pay = PaymentTxn(sender=deployer_addr, sp=sp, receiver=addr, amt=2_000_000)
    wait_confirmed(client, client.send_transaction(pay.sign(deployer_sk)))
    print("  Funded: 2 ALGO")

    # ── Step 3: Configure ──────────────────────────────────────
    print("\n--- Step 3: Configure ---")
    # set_treasury(app_id, orchestrator_address) — authorizes orchestrator to
    # call mark_invested, mark_redeemed, transfer_to_treasury, receive_from_treasury,
    # AND complete_order
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_treasury(uint64,address)void", [TBILL_APP_ID, orch_addr])
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_platform_wallet(address)void", [PLATFORM_WALLET])

    # ── Step 4: Update TBill's escrow reference ────────────────
    print("\n--- Step 4: Update TBill -> new Escrow ---")
    call_abi(client, deployer_sk, deployer_addr, TBILL_APP_ID,
             "set_escrow(uint64)void", [app_id])
    print(f"  TBill {TBILL_APP_ID} now points to Escrow {app_id}")

    # ── Step 5: Write .env ─────────────────────────────────────
    print("\n--- Step 5: Update .env ---")
    write_env("ESCROW_APP_ID", str(app_id))
    print("  ESCROW_APP_ID updated")

    # ── Summary ────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  DEPLOYMENT COMPLETE")
    print("=" * 60)
    print(f"\n  CadenciaEscrow v2")
    print(f"    App ID:   {app_id}")
    print(f"    Address:  {addr}")
    print(f"    Explorer: https://testnet.explorer.perawallet.app/application/{app_id}")
    print(f"\n  Auto-complete: ENABLED (orchestrator can complete REDEEMED orders)")
    print(f"\n  Next: Restart the orchestrator")
    print(f"    cd orchestrator && npx ts-node src/index.ts")
    print("=" * 60)

if __name__ == "__main__":
    main()
