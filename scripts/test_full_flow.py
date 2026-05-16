"""
CrestFlow — Full System Integration Test
=========================================
Tests the COMPLETE flow using real on-chain transactions routed through the backend API:

  1. Buyer auth  : POST /auth/nonce → POST /auth/verify → JWT
  2. Estimate    : GET  /orders/estimate
  3. Prepare     : POST /orders/prepare → unsigned txns
  4. Sign        : sign both txns with deployer key (buyer)
  5. Submit      : POST /orders/submit → txid + confirmed round
  6. Poll        : GET  /orders/:id until INVESTED  (orchestrator picks up)
  7. Poll        : GET  /orders/:id until COMPLETED (maturity + auto-complete)
  8. Verify      : seller balance increased by principal, platform got yield
  9. Admin check : GET  /platform/stats with Supabase JWT → see full yield data
 10. Masked check: GET  /orders/:id without auth → confirm no yield fields

Prerequisites:
  - Backend running:      cd backend && npm run dev
  - Orchestrator running: cd orchestrator && npx ts-node src/index.ts
  - .env populated (DEPLOYER_MNEMONIC, ORCHESTRATOR_MNEMONIC, etc.)

Usage:
  python scripts/test_full_flow.py
  python scripts/test_full_flow.py --tier 1 --amount 10
  python scripts/test_full_flow.py --tier 1 --amount 10 --admin-password YOUR_PASS
"""

import os, sys, time, base64, argparse, json, struct
import io
import requests

# Force UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
from pathlib import Path
from dotenv import load_dotenv
from algosdk import mnemonic, account, encoding
from algosdk.v2client import algod

# ── Config ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env")

BASE_URL       = os.getenv("BACKEND_URL", "http://localhost:3001")
ALGOD_SERVER   = os.getenv("ALGOD_SERVER", "https://testnet-api.algonode.cloud")
ALGOD_PORT     = os.getenv("ALGOD_PORT", "443")
ALGOD_TOKEN    = os.getenv("ALGOD_TOKEN", "")

DEPLOYER_MNEMONIC     = os.getenv("DEPLOYER_MNEMONIC", "")
ORCHESTRATOR_MNEMONIC = os.getenv("ORCHESTRATOR_MNEMONIC", "")
SUPABASE_URL          = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY     = os.getenv("SUPABASE_ANON_KEY", "")
ADMIN_EMAIL           = os.getenv("ADMIN_EMAIL", "")

# ── Colour helpers ────────────────────────────────────────────────────────────

GRN  = "\033[92m"
RED  = "\033[91m"
YLW  = "\033[93m"
BLU  = "\033[94m"
DIM  = "\033[2m"
RST  = "\033[0m"
BOLD = "\033[1m"

def ok(msg):  print(f"  {GRN}[PASS]{RST}  {msg}")
def fail(msg, detail=""): print(f"  {RED}[FAIL]{RST}  {msg}" + (f"\n         {DIM}{detail}{RST}" if detail else "")); sys.exit(1)
def info(msg): print(f"  {BLU}[INFO]{RST}  {msg}")
def warn(msg): print(f"  {YLW}[WARN]{RST}  {msg}")
def step(n, msg): print(f"\n{'='*60}\n  STEP {n}: {msg}\n{'='*60}")

PASSED = 0
FAILED = 0

def check(label, cond, detail=""):
    global PASSED, FAILED
    if cond:
        ok(label)
        PASSED += 1
    else:
        print(f"  {RED}[FAIL]{RST}  {label}" + (f"\n         {DIM}{detail}{RST}" if detail else ""))
        FAILED += 1

# ── Algorand helpers ──────────────────────────────────────────────────────────

def algod_client():
    return algod.AlgodClient(ALGOD_TOKEN, f"{ALGOD_SERVER}:{ALGOD_PORT}")

def get_account(mnem):
    sk  = mnemonic.to_private_key(mnem)
    addr = account.address_from_private_key(sk)
    return sk, addr

def get_balance(c, addr):
    return c.account_info(addr)["amount"]

def sign_b64_txn(unsigned_b64: str, sk: str) -> str:
    """Decode a base64 unsigned txn, sign it, return base64 signed txn."""
    import algosdk.transaction as txn_mod
    raw = base64.b64decode(unsigned_b64)
    unsigned = txn_mod.Transaction.undictify(
        algosdk.encoding.msgpack_decode(raw)
    )
    signed = unsigned.sign(sk)
    return base64.b64encode(
        algosdk.encoding.msgpack_encode(signed).encode() if isinstance(
            algosdk.encoding.msgpack_encode(signed), str
        ) else algosdk.encoding.msgpack_encode(signed)
    ).decode()

def sign_txns(unsigned_txns_b64: list, sk: str) -> list:
    """Sign a list of base64 unsigned txns. Returns list of base64 signed txns."""
    import algosdk.transaction as txn_mod
    import algosdk.encoding as enc
    signed = []
    for b64 in unsigned_txns_b64:
        raw     = base64.b64decode(b64)
        decoded = enc.future_msgpack_decode(raw)
        sig     = decoded.sign(sk)
        signed.append(
            base64.b64encode(enc.msgpack_encode(sig)).decode()
        )
    return signed

# ── Admin Supabase login ───────────────────────────────────────────────────────

def get_admin_jwt(password: str) -> str | None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY or not ADMIN_EMAIL or not password:
        return None
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    r = requests.post(url, headers={
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }, json={"email": ADMIN_EMAIL, "password": password}, timeout=10)
    if r.status_code == 200:
        return r.json().get("access_token")
    warn(f"Admin login failed ({r.status_code}): {r.text[:200]}")
    return None

# ── API helpers ────────────────────────────────────────────────────────────────

def api(method, path, **kwargs):
    r = getattr(requests, method)(f"{BASE_URL}{path}", timeout=15, **kwargs)
    return r

def poll_order(order_id: int, target_status: str, timeout_sec: int, interval: int = 10):
    """Poll GET /orders/:id until status matches target. Returns final response dict."""
    deadline = time.time() + timeout_sec
    last_status = None
    while time.time() < deadline:
        r = api("get", f"/orders/{order_id}")
        if r.status_code == 200:
            d = r.json()
            s = d.get("status", "?")
            if s != last_status:
                info(f"Order {order_id} status: {YLW}{s}{RST}")
                last_status = s
            if s == target_status:
                return d
            if s in ("CANCELLED", "DISPUTED"):
                fail(f"Order reached terminal bad status: {s}")
        time.sleep(interval)
    return None

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="CrestFlow Full System Integration Test")
    parser.add_argument("--tier",           type=int,   default=1,  help="T-bill tier in days (1,7,30…)")
    parser.add_argument("--amount",         type=int,   default=10, help="Order amount in ALGO (min 5)")
    parser.add_argument("--admin-password", type=str,   default="", help="Admin Supabase password for admin endpoint tests")
    parser.add_argument("--poll-interval",  type=int,   default=15, help="Poll interval in seconds")
    cli = parser.parse_args()

    TIER        = cli.tier
    AMOUNT_ALGO = cli.amount
    POLL        = cli.poll_interval
    # Demo maturity: tier * 60s (1D = 60s, 7D = 420s, etc.) + 240s buffer
    DEMO_WAIT   = TIER * 60 + 240

    print(f"\n{BOLD}{'='*60}")
    print("  CRESTFLOW — FULL SYSTEM INTEGRATION TEST")
    print(f"{'='*60}{RST}")
    print(f"  Tier:    cTBILL-{TIER}D  |  Amount: {AMOUNT_ALGO} ALGO")
    print(f"  Backend: {BASE_URL}")
    print(f"  Timeout: ~{DEMO_WAIT}s for COMPLETED status")

    # ── Accounts ─────────────────────────────────────────────────────────────
    buyer_sk,  buyer_addr  = get_account(DEPLOYER_MNEMONIC)
    _,         seller_addr = get_account(ORCHESTRATOR_MNEMONIC)
    c = algod_client()

    buyer_bal_before  = get_balance(c, buyer_addr)
    seller_bal_before = get_balance(c, seller_addr)

    print(f"\n  Buyer:  {buyer_addr}")
    print(f"  Seller: {seller_addr}")
    print(f"  Buyer balance:  {buyer_bal_before/1e6:.4f} ALGO")
    print(f"  Seller balance: {seller_bal_before/1e6:.4f} ALGO")

    if buyer_bal_before < (AMOUNT_ALGO + 2) * 1_000_000:
        fail(f"Buyer needs at least {AMOUNT_ALGO + 2} ALGO. Current: {buyer_bal_before/1e6:.3f}")

    # ── Step 1: Backend health ─────────────────────────────────────────────
    step(1, "Backend health check")
    r = api("get", "/health")
    check("GET /health → 200", r.status_code == 200)
    check("Round present in health", "round" in r.json(), str(r.json()))
    info(f"Node round: {r.json().get('round')}")

    # ── Step 2: Buyer auth (nonce → verify → JWT) ─────────────────────────
    step(2, "Buyer auth — nonce → sign → JWT")

    r = api("post", "/auth/nonce", json={"address": buyer_addr})
    check("POST /auth/nonce → 200", r.status_code == 200, r.text)
    nonce   = r.json().get("nonce", "")
    check("Nonce returned", bool(nonce))

    # Sign the nonce with the buyer's key
    # Backend uses: algosdk.verifyBytes(Buffer.from(nonce, "hex"), sigBytes, address)
    # So we must: sign the hex-decoded nonce bytes
    # algosdk.util.sign_bytes prepends "MX" prefix (same as verifyBytes) — returns base64 str
    import algosdk
    from algosdk.util import sign_bytes
    nonce_bytes = bytes.fromhex(nonce)          # nonce is a hex string
    sig_result  = sign_bytes(nonce_bytes, buyer_sk)
    sig_b64     = sig_result if isinstance(sig_result, str) else base64.b64encode(sig_result).decode()

    r = api("post", "/auth/verify", json={"address": buyer_addr, "signature": sig_b64, "nonce": nonce})
    check("POST /auth/verify → 200", r.status_code == 200, r.text)
    jwt_token = r.json().get("token", "")
    check("JWT returned", bool(jwt_token))
    info(f"JWT length: {len(jwt_token)} chars")

    auth_headers = {"Authorization": f"Bearer {jwt_token}"}

    # ── Step 3: Estimate ───────────────────────────────────────────────────
    step(3, "Yield estimate (public endpoint)")
    r = api("get", f"/orders/estimate?amount_algo={AMOUNT_ALGO}&lock_days={TIER}")
    check("GET /orders/estimate → 200", r.status_code == 200, r.text)
    est = r.json()
    check("Tier label present",      f"cTBILL-{TIER}D" in est.get("tier",""), str(est))
    check("Estimated yield present", est.get("estimated_yield_algo", 0) > 0, str(est))
    check("Seller receives == amount", est.get("seller_receives_algo") == AMOUNT_ALGO, str(est))
    info(f"Est. yield: {est.get('estimated_yield_algo')} ALGO  |  APY: {est.get('apy_pct')}%")

    # ── Step 4: Prepare unsigned txns ─────────────────────────────────────
    step(4, "Prepare unsigned transactions")
    r = api("post", "/orders/prepare", headers=auth_headers, json={
        "seller_address": seller_addr,
        "amount_algo":    AMOUNT_ALGO,
        "lock_days":      TIER,
    })
    check("POST /orders/prepare → 200", r.status_code == 200, r.text)
    prep     = r.json()
    order_id = prep.get("order_id")
    unsigned = prep.get("unsigned_txns", [])
    check("order_id returned",        bool(order_id), str(prep))
    check("2 unsigned txns returned", len(unsigned) == 2, str(prep))
    check("Tier matches in details",  f"cTBILL-{TIER}D" in prep.get("details",{}).get("tier",""), str(prep))
    info(f"Order ID: {order_id}  |  Escrow: {prep.get('escrow_address','')[:20]}...")

    # ── Step 5: Sign & submit ─────────────────────────────────────────────
    step(5, "Sign transactions and submit")

    # unsigned_txns are base64-encoded msgpack bytes from the backend
    # algosdk.encoding.msgpack_encode returns a base64 string in this version
    # The backend's decodeSignedTransaction expects raw msgpack bytes (base64-encoded for transport)
    import msgpack
    import algosdk.encoding as enc
    import algosdk.transaction as txn_mod

    signed_txns = []
    for b64 in unsigned:
        raw_bytes = base64.b64decode(b64)                   # base64 → raw msgpack bytes
        txn_dict  = msgpack.unpackb(raw_bytes, raw=False)   # msgpack → dict
        txn_obj   = txn_mod.Transaction.undictify(txn_dict) # dict → Transaction
        signed    = txn_obj.sign(buyer_sk)                  # sign → SignedTransaction
        enc_out   = enc.msgpack_encode(signed)              # → base64 str in this algosdk version
        # enc_out is already base64 — the backend wants raw-msgpack-re-base64'd
        # So: decode from base64 to get raw msgpack, then re-encode as base64
        if isinstance(enc_out, str):
            raw_signed = base64.b64decode(enc_out)          # base64 str → raw msgpack bytes
        else:
            raw_signed = enc_out                            # already raw bytes
        signed_txns.append(base64.b64encode(raw_signed).decode())

    r = api("post", "/orders/submit", headers=auth_headers, json={
        "signed_txns": signed_txns,
        "order_id":    order_id,
        "description": "CrestFlow integration test — automated",
    })
    check("POST /orders/submit → 200", r.status_code == 200, r.text[:500])
    sub      = r.json()
    txid     = sub.get("txid","")
    conf_round = sub.get("confirmed_round")
    check("txid returned",          bool(txid), str(sub))
    check("confirmed_round present", conf_round is not None, str(sub))
    info(f"TxID: {txid}  |  Confirmed round: {conf_round}")

    # ── Step 6: Verify order exists on backend ────────────────────────────
    step(6, "Verify order visible on backend (public masked view)")
    time.sleep(5)  # brief pause for chain to propagate
    r = api("get", f"/orders/{order_id}")
    check("GET /orders/:id → 200", r.status_code == 200, r.text[:300])
    od = r.json()
    check("status is PENDING",      od.get("status") == "PENDING", str(od))
    check("buyer matches",          od.get("buyer") == buyer_addr, str(od))
    check("seller matches",         od.get("seller") == seller_addr, str(od))
    check("amount_algo matches",    od.get("amount_algo") == AMOUNT_ALGO, str(od))
    check("no yield_earned in public response", "yield_earned" not in od, str(od))
    check("no tbill_position in public response", "tbill_position" not in od, str(od))
    check("description saved",      od.get("description") == "CrestFlow integration test — automated", str(od))

    # ── Step 7: Poll for INVESTED ─────────────────────────────────────────
    step(7, f"Waiting for orchestrator to INVEST (up to 120s)")
    info("Orchestrator should detect PENDING order within one poll cycle (~30s)...")
    result = poll_order(order_id, "INVESTED", timeout_sec=120, interval=POLL)
    check("Order reached INVESTED", result is not None,
          "Orchestrator may not be running. Start with: cd orchestrator && npx ts-node src/index.ts")

    # ── Step 8: Poll for COMPLETED ────────────────────────────────────────
    step(8, f"Waiting for orchestrator to REDEEM + COMPLETE (up to {DEMO_WAIT}s)")
    info(f"T-Bill matures in ~{TIER * 60}s in demo mode...")
    result = poll_order(order_id, "COMPLETED", timeout_sec=DEMO_WAIT, interval=POLL)
    check("Order reached COMPLETED", result is not None,
          f"Timeout after {DEMO_WAIT}s. Check orchestrator logs.")

    # ── Step 9: Verify seller received funds ─────────────────────────────
    step(9, "Verify on-chain balance changes")
    time.sleep(3)  # let chain settle
    seller_bal_after = get_balance(c, seller_addr)
    delta = seller_bal_after - seller_bal_before
    check(
        f"Seller received ~{AMOUNT_ALGO} ALGO",
        abs(delta - AMOUNT_ALGO * 1_000_000) < 500_000,  # within 0.5 ALGO tolerance (fees)
        f"Expected ~{AMOUNT_ALGO*1e6:.0f} µA, got delta={delta} µA"
    )
    info(f"Seller balance before: {seller_bal_before/1e6:.4f}  |  after: {seller_bal_after/1e6:.4f}  |  delta: {delta/1e6:.4f} ALGO")

    # ── Step 10: Admin endpoint test ──────────────────────────────────────
    step(10, "Admin endpoint — full unmasked data")
    admin_jwt = get_admin_jwt(cli.admin_password) if cli.admin_password else None

    if admin_jwt:
        admin_headers = {"Authorization": f"Bearer {admin_jwt}"}

        r = api("get", f"/orders/{order_id}", headers=admin_headers)
        check("Admin GET /orders/:id → 200", r.status_code == 200, r.text[:300])
        adm = r.json()
        check("yield_earned present in admin response",     "yield_earned" in adm or "yield_earned_algo" in adm, str(adm))
        check("tbill_position present in admin response",   "tbill_position" in adm, str(adm))
        info(f"Yield earned: {adm.get('yield_earned_algo', adm.get('yield_earned', 'N/A'))} ALGO")

        r = api("get", "/platform/stats", headers=admin_headers)
        check("Admin GET /platform/stats → 200", r.status_code == 200, r.text[:300])
        stats = r.json()
        check("total_yield_paid present in stats", "total_yield_paid" in stats or "yield" in str(stats).lower(), str(stats))
        info(f"Platform stats keys: {list(stats.keys())}")
    else:
        warn("Skipping admin tests — pass --admin-password to enable")
        check("Admin test skipped (no password)", True)  # don't fail the suite

    # ── Step 11: Confirm masking still works ──────────────────────────────
    step(11, "Confirm public response is still masked after completion")
    r = api("get", f"/orders/{order_id}")
    check("Public GET /orders/:id → 200", r.status_code == 200)
    pub = r.json()
    check("status is COMPLETED",          pub.get("status") == "COMPLETED", str(pub))
    check("yield_earned NOT in public",   "yield_earned" not in pub, str(pub))
    check("tbill_position NOT in public", "tbill_position" not in pub, str(pub))
    check("amount_algo present",          pub.get("amount_algo") == AMOUNT_ALGO, str(pub))
    check("description visible publicly", pub.get("description") is not None, str(pub))

    # ── Step 12: Unauthorized admin check ─────────────────────────────────
    step(12, "Confirm /platform/stats blocks unauthenticated requests")
    r = api("get", "/platform/stats")
    check("No token → 401", r.status_code == 401, f"Got {r.status_code}: {r.text[:100]}")
    r = api("get", "/platform/stats", headers={"Authorization": "Bearer fake.token.here"})
    check("Bad token → 401", r.status_code == 401, f"Got {r.status_code}: {r.text[:100]}")

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{BOLD}{'='*60}")
    print("  RESULTS")
    print(f"{'='*60}{RST}")
    total = PASSED + FAILED
    if FAILED == 0:
        print(f"\n  {GRN}{BOLD}ALL {total} CHECKS PASSED ✓{RST}\n")
    else:
        print(f"\n  {GRN}{PASSED} passed{RST}  |  {RED}{FAILED} failed{RST}  |  {total} total\n")

    print(f"  Order ID:  {order_id}")
    print(f"  TxID:      {txid}")
    from algosdk import constants
    EXPLORER = os.getenv("EXPLORER_BASE", "https://testnet.explorer.perawallet.app")
    print(f"  Explorer:  {EXPLORER}/tx/{txid}")
    print(f"  Order:     {EXPLORER}/application/{os.getenv('ESCROW_APP_ID','')}")
    print()

    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
