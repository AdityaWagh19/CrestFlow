"""
Cadencia Treasury - CadenciaTBill v2 Deployment Script
Deploys the new 7-tier T-bill contract, creates all ASAs, configures
links, and writes the new App ID + ASA IDs back to .env.

Run: python scripts/deploy_tbill_v2.py
"""

import os
import sys
import base64
import time
from pathlib import Path

from dotenv import load_dotenv, set_key
from algosdk import mnemonic, account, encoding
from algosdk.v2client import algod
from algosdk.transaction import (
    ApplicationCreateTxn, OnComplete, StateSchema, PaymentTxn,
)
from algosdk.abi import Method as ABIMethod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer, AccountTransactionSigner,
)

# ── Config ────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent
ENV_PATH     = PROJECT_ROOT / ".env"
ARTIFACT_DIR = PROJECT_ROOT / "smart_contracts" / "cadencia_tbill" / "artifacts" / "cadencia_tbill"

load_dotenv(ENV_PATH)

ALGOD_SERVER = os.getenv("ALGOD_SERVER", "https://testnet-api.algonode.cloud")
ALGOD_PORT   = os.getenv("ALGOD_PORT",   "443")
ALGOD_TOKEN  = os.getenv("ALGOD_TOKEN",  "")

DEPLOYER_MNEMONIC   = os.getenv("DEPLOYER_MNEMONIC", "")
ORCHESTRATOR_MN     = os.getenv("ORCHESTRATOR_MNEMONIC", "")
PLATFORM_WALLET     = os.getenv("PLATFORM_WALLET_ADDRESS", "")
ESCROW_APP_ID       = int(os.getenv("ESCROW_APP_ID", "0"))

# Global schema for CadenciaTBill v2 (7 tiers)
# UInts: escrow_app_id, yield_rate_bps, demo_mode, demo_multiplier,
#        tbill_1d..90d_asa (7), total_invested, total_yield_paid,
#        active_positions, paused = 15
# Bytes: admin, orchestrator = 2
NUM_UINTS = 15
NUM_BYTES = 2

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
    raise Exception(f"Tx {tx_id} not confirmed after {timeout} rounds")

def compile_teal(client, teal_path: Path) -> bytes:
    result = client.compile(teal_path.read_text())
    return base64.b64decode(result["result"])

def call_abi(client, sk, addr, app_id, method_sig, args, fee=2000, boxes=None):
    method = ABIMethod.from_signature(method_sig)
    signer  = AccountTransactionSigner(sk)
    atc     = AtomicTransactionComposer()
    sp      = client.suggested_params()
    sp.fee  = fee
    sp.flat_fee = True
    atc.add_method_call(
        app_id=app_id, method=method, sender=addr, sp=sp,
        signer=signer, method_args=args,
        boxes=boxes or [],
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

def write_env(key, value):
    """Update or append a key=value in .env"""
    content = ENV_PATH.read_text()
    lines = content.splitlines()
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

# ── Main ─────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  CADENCIA TBILL v2 — DEPLOYMENT")
    print("  7 Maturity Tiers: 1D/3D/7D/14D/30D/60D/90D")
    print("=" * 60)

    client = get_client()
    deployer_sk, deployer_addr = get_deployer()
    orch_addr = get_orchestrator_addr()

    status  = client.status()
    balance = client.account_info(deployer_addr)["amount"] / 1_000_000  # type: ignore[index]
    print(f"\n  Network:     Algorand Testnet (round {status['last-round']})")
    print(f"  Deployer:    {deployer_addr}  ({balance:.3f} ALGO)")
    print(f"  Orchestrator:{orch_addr}")
    print(f"  Escrow App:  {ESCROW_APP_ID}")

    if balance < 20:
        print("\n  [FAIL] Need at least 20 ALGO in deployer wallet")
        sys.exit(1)

    # ── Step 1: Deploy ─────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 1: Deploy CadenciaTBill v2")
    print("=" * 60)

    approval = compile_teal(client, ARTIFACT_DIR / "CadenciaTBill.approval.teal")
    clear    = compile_teal(client, ARTIFACT_DIR / "CadenciaTBill.clear.teal")
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
    result = wait_for_confirmation(client, client.send_transaction(txn.sign(deployer_sk)))
    app_id  = result["application-index"]
    app_addr = encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))
    print(f"  App ID:  {app_id}")
    print(f"  Address: {app_addr}")

    # ── Step 2: Fund ───────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 2: Fund Contract")
    print("=" * 60)

    # 0.1 base + 7 ASAs × 0.1 MBR + 7 positions MBR + yield reserve
    fund_amount = 10_000_000  # 10 ALGO
    sp = client.suggested_params()
    sp.fee = 1000
    sp.flat_fee = True
    pay_txn = PaymentTxn(sender=deployer_addr, sp=sp, receiver=app_addr, amt=fund_amount)
    wait_for_confirmation(client, client.send_transaction(pay_txn.sign(deployer_sk)))
    print(f"  Funded: 10 ALGO -> {app_addr[:20]}...")

    # ── Step 3: Configure ──────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 3: Configure Contract")
    print("=" * 60)

    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_orchestrator(address)void", [orch_addr])
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_escrow(uint64)void", [ESCROW_APP_ID])
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_yield_rate(uint64)void", [500])  # 5% APY
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "set_demo_mode(uint64,uint64)void", [1, 60])  # 1 day = 60s

    # ── Step 4: Create Short-Term ASAs ─────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 4: Create Short-Term ASAs (1D/3D/7D/14D)")
    print("=" * 60)

    # Fee: 1 base + 4 inner ASA creates × 0.001 = 0.005 ALGO total
    call_abi(client, deployer_sk, deployer_addr, app_id,
             "create_tbill_asas_short()void", [], fee=5000)

    time.sleep(2)  # wait for indexer to catch up

    # ── Step 5: Create Long-Term ASAs ──────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 5: Create Long-Term ASAs (30D/60D/90D)")
    print("=" * 60)

    call_abi(client, deployer_sk, deployer_addr, app_id,
             "create_tbill_asas_long()void", [], fee=4000)

    time.sleep(2)

    # ── Step 6: Read ASA IDs ───────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 6: Read ASA IDs from Global State")
    print("=" * 60)

    gs = read_global_state(client, app_id)

    # Key names match the AlgoPy attribute names
    asa_map = {
        "TBILL_1D_ASA":  gs.get("tbill_1d_asa",  0),
        "TBILL_3D_ASA":  gs.get("tbill_3d_asa",  0),
        "TBILL_7D_ASA":  gs.get("tbill_7d_asa",  0),
        "TBILL_14D_ASA": gs.get("tbill_14d_asa", 0),
        "TBILL_30D_ASA": gs.get("tbill_30d_asa", 0),
        "TBILL_60D_ASA": gs.get("tbill_60d_asa", 0),
        "TBILL_90D_ASA": gs.get("tbill_90d_asa", 0),
    }

    for key, val in asa_map.items():
        tier = key.replace("TBILL_", "").replace("_ASA", "")
        print(f"  cTBILL-{tier}: ASA {val}")

    # ── Step 7: Write .env ─────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 7: Update .env")
    print("=" * 60)

    write_env("TBILL_APP_ID", str(app_id))
    for key, val in asa_map.items():
        write_env(key, str(val))

    print("  .env updated")

    # ── Summary ────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  DEPLOYMENT COMPLETE")
    print("=" * 60)
    print(f"\n  CadenciaTBill v2")
    print(f"    App ID:  {app_id}")
    print(f"    Address: {app_addr}")
    print(f"    Explorer: https://testnet.explorer.perawallet.app/application/{app_id}")
    print(f"\n  T-Bill ASAs:")
    for key, val in asa_map.items():
        tier = key.replace("TBILL_", "").replace("_ASA", "")
        print(f"    cTBILL-{tier:<4}  ASA {val}  https://testnet.explorer.perawallet.app/asset/{val}")
    print(f"\n  Demo Mode: ON (1 day = 60 seconds)")
    print(f"  APY:       5.00%")
    print(f"\n  Next: Run 'npx ts-node src/index.ts' in orchestrator/")
    print("=" * 60)


if __name__ == "__main__":
    main()
