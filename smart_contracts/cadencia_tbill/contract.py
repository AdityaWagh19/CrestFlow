"""
Cadencia Treasury - T-Bill Contract
Issues tokenized T-bill ASAs for 7 maturity periods:
  cTB1D, cTB3D, cTB7D, cTB14D, cTB30D, cTB60D, cTB90D

Accepts ALGO deposits, enforces maturity via Unix timestamps,
and pays yield from a pre-funded reserve.
Supports demo mode with compressed time for testnet demos.
"""

from algopy import (
    ARC4Contract, BoxMap, Global, Txn, UInt64, arc4, gtxn, itxn, subroutine,
)

# T-bill type constants (days)
TBILL_1D  = 1
TBILL_3D  = 3
TBILL_7D  = 7
TBILL_14D = 14
TBILL_30D = 30
TBILL_60D = 60
TBILL_90D = 90

# Position status
POS_ACTIVE   = 0
POS_REDEEMED = 1


class TBillPosition(arc4.Struct):
    """Per-order T-bill position stored in Box storage."""
    principal: arc4.UInt64           # ALGO deposited (microALGO)
    tbill_type: arc4.UInt8           # days: 1, 3, 7, 14, 30, 60, or 90
    maturity_timestamp: arc4.UInt64  # Unix timestamp when redeemable
    invested_at: arc4.UInt64         # Unix timestamp of investment
    status: arc4.UInt8               # 0=active, 1=redeemed


class TBillStats(arc4.Struct):
    total_invested: arc4.UInt64
    total_yield_paid: arc4.UInt64
    active_positions: arc4.UInt64


class AsaIds(arc4.Struct):
    tbill_1d: arc4.UInt64
    tbill_3d: arc4.UInt64
    tbill_7d: arc4.UInt64
    tbill_14d: arc4.UInt64
    tbill_30d: arc4.UInt64
    tbill_60d: arc4.UInt64
    tbill_90d: arc4.UInt64


class CadenciaTBill(ARC4Contract):

    def __init__(self) -> None:
        # Access control
        self.admin = Global.creator_address
        self.orchestrator = Global.zero_address
        self.escrow_app_id = UInt64(0)

        # Yield config
        self.yield_rate_bps = UInt64(500)  # 5.00% APY

        # Demo mode: compressed time for testnet demos
        self.demo_mode = UInt64(1)         # 1=demo, 0=production
        self.demo_multiplier = UInt64(60)  # seconds per "day" in demo

        # ASA IDs for each T-bill tier (set after create_tbill_asas calls)
        self.tbill_1d_asa  = UInt64(0)
        self.tbill_3d_asa  = UInt64(0)
        self.tbill_7d_asa  = UInt64(0)
        self.tbill_14d_asa = UInt64(0)
        self.tbill_30d_asa = UInt64(0)
        self.tbill_60d_asa = UInt64(0)
        self.tbill_90d_asa = UInt64(0)

        # Aggregate stats
        self.total_invested  = UInt64(0)
        self.total_yield_paid = UInt64(0)
        self.active_positions = UInt64(0)

        # Emergency
        self.paused = UInt64(0)

        # Box storage: order_id -> TBillPosition
        self.positions = BoxMap(arc4.UInt64, TBillPosition)

    # ── ASA CREATION ─────────────────────────────────────────────

    @arc4.abimethod()
    def create_tbill_asas_short(self) -> None:
        """Create short-term T-bill ASAs: 1D, 3D, 7D, 14D. Call once after deploy."""
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        assert self.tbill_1d_asa == UInt64(0), "ALREADY_CREATED"

        self.tbill_1d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB1D",
                asset_name="Cadencia T-Bill 1D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

        self.tbill_3d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB3D",
                asset_name="Cadencia T-Bill 3D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

        self.tbill_7d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB7D",
                asset_name="Cadencia T-Bill 7D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

        self.tbill_14d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB14D",
                asset_name="Cadencia T-Bill 14D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

    @arc4.abimethod()
    def create_tbill_asas_long(self) -> None:
        """Create medium/long-term T-bill ASAs: 30D, 60D, 90D. Call after create_tbill_asas_short."""
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        assert self.tbill_14d_asa != UInt64(0), "CREATE_SHORT_FIRST"
        assert self.tbill_30d_asa == UInt64(0), "ALREADY_CREATED"

        self.tbill_30d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB30D",
                asset_name="Cadencia T-Bill 30D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

        self.tbill_60d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB60D",
                asset_name="Cadencia T-Bill 60D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

        self.tbill_90d_asa = (
            itxn.AssetConfig(
                total=UInt64(1_000_000_000_000),
                decimals=UInt64(6),
                unit_name="cTB90D",
                asset_name="Cadencia T-Bill 90D",
                manager=Global.current_application_address,
                reserve=Global.current_application_address,
                fee=UInt64(0),
            )
            .submit()
            .created_asset.id
        )

    # ── INVEST ────────────────────────────────────────────────────

    @arc4.abimethod()
    def invest(
        self,
        pay_txn: gtxn.PaymentTransaction,
        order_id: arc4.UInt64,
        tbill_type: arc4.UInt8,
    ) -> None:
        """
        Accept ALGO payment, record T-bill position with maturity timestamp.
        tbill_type must be one of: 1, 3, 7, 14, 30, 60, 90.
        """
        assert Txn.sender == self.orchestrator, "UNAUTHORIZED"
        assert self.paused == UInt64(0), "TBILL_PAUSED"
        assert pay_txn.receiver == Global.current_application_address, "INVALID_PAYMENT"
        assert pay_txn.amount > UInt64(0), "ZERO_AMOUNT"
        assert order_id not in self.positions, "ALREADY_INVESTED"

        days = tbill_type.native
        assert (
            days == UInt64(TBILL_1D)
            or days == UInt64(TBILL_3D)
            or days == UInt64(TBILL_7D)
            or days == UInt64(TBILL_14D)
            or days == UInt64(TBILL_30D)
            or days == UInt64(TBILL_60D)
            or days == UInt64(TBILL_90D)
        ), "INVALID_TYPE"

        maturity = self._calc_maturity(days)

        self.positions[order_id] = TBillPosition(
            principal=arc4.UInt64(pay_txn.amount),
            tbill_type=tbill_type,
            maturity_timestamp=arc4.UInt64(maturity),
            invested_at=arc4.UInt64(Global.latest_timestamp),
            status=arc4.UInt8(POS_ACTIVE),
        )

        self.total_invested += pay_txn.amount
        self.active_positions += UInt64(1)

    # ── REDEEM ────────────────────────────────────────────────────

    @arc4.abimethod()
    def redeem(self, order_id: arc4.UInt64) -> arc4.UInt64:
        """
        Redeem a matured T-bill position.
        Returns principal + yield in ALGO to the orchestrator.
        """
        assert Txn.sender == self.orchestrator, "UNAUTHORIZED"
        assert order_id in self.positions, "POSITION_NOT_FOUND"

        pos = self.positions[order_id].copy()
        assert pos.status == arc4.UInt8(POS_ACTIVE), "ALREADY_REDEEMED"
        assert Global.latest_timestamp >= pos.maturity_timestamp.native, "NOT_MATURED"

        principal = pos.principal.native
        days = pos.tbill_type.native
        yield_amount = self._calc_yield(principal, days)
        total = principal + yield_amount

        itxn.Payment(
            receiver=Txn.sender,
            amount=total,
            fee=UInt64(0),
        ).submit()

        self.positions[order_id] = TBillPosition(
            principal=pos.principal,
            tbill_type=pos.tbill_type,
            maturity_timestamp=pos.maturity_timestamp,
            invested_at=pos.invested_at,
            status=arc4.UInt8(POS_REDEEMED),
        )

        self.total_invested -= principal
        self.total_yield_paid += yield_amount
        self.active_positions -= UInt64(1)

        return arc4.UInt64(total)

    # ── READ-ONLY ─────────────────────────────────────────────────

    @arc4.abimethod(readonly=True)
    def get_position(self, order_id: arc4.UInt64) -> TBillPosition:
        assert order_id in self.positions, "POSITION_NOT_FOUND"
        return self.positions[order_id].copy()

    @arc4.abimethod(readonly=True)
    def get_maturity(self, order_id: arc4.UInt64) -> arc4.UInt64:
        assert order_id in self.positions, "POSITION_NOT_FOUND"
        pos = self.positions[order_id].copy()
        return pos.maturity_timestamp

    @arc4.abimethod(readonly=True)
    def get_estimated_yield(self, order_id: arc4.UInt64) -> arc4.UInt64:
        if order_id not in self.positions:
            return arc4.UInt64(0)
        pos = self.positions[order_id].copy()
        if pos.status != arc4.UInt8(POS_ACTIVE):
            return arc4.UInt64(0)
        return arc4.UInt64(self._calc_yield(pos.principal.native, pos.tbill_type.native))

    @arc4.abimethod(readonly=True)
    def get_stats(self) -> TBillStats:
        return TBillStats(
            total_invested=arc4.UInt64(self.total_invested),
            total_yield_paid=arc4.UInt64(self.total_yield_paid),
            active_positions=arc4.UInt64(self.active_positions),
        )

    @arc4.abimethod(readonly=True)
    def get_asa_ids(self) -> AsaIds:
        return AsaIds(
            tbill_1d=arc4.UInt64(self.tbill_1d_asa),
            tbill_3d=arc4.UInt64(self.tbill_3d_asa),
            tbill_7d=arc4.UInt64(self.tbill_7d_asa),
            tbill_14d=arc4.UInt64(self.tbill_14d_asa),
            tbill_30d=arc4.UInt64(self.tbill_30d_asa),
            tbill_60d=arc4.UInt64(self.tbill_60d_asa),
            tbill_90d=arc4.UInt64(self.tbill_90d_asa),
        )

    @arc4.abimethod(readonly=True)
    def is_matured(self, order_id: arc4.UInt64) -> arc4.Bool:
        assert order_id in self.positions, "POSITION_NOT_FOUND"
        pos = self.positions[order_id].copy()
        return arc4.Bool(Global.latest_timestamp >= pos.maturity_timestamp.native)

    # ── ADMIN ─────────────────────────────────────────────────────

    @arc4.abimethod()
    def fund_reserve(self, pay_txn: gtxn.PaymentTransaction) -> None:
        """Add ALGO to the yield reserve."""
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        assert pay_txn.receiver == Global.current_application_address, "INVALID_PAYMENT"

    @arc4.abimethod()
    def set_yield_rate(self, rate_bps: arc4.UInt64) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.yield_rate_bps = rate_bps.native

    @arc4.abimethod()
    def set_demo_mode(self, enabled: arc4.UInt64, multiplier: arc4.UInt64) -> None:
        """Toggle demo mode. multiplier = seconds per 'day' (60 = 1 day = 1 min)."""
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.demo_mode = enabled.native
        self.demo_multiplier = multiplier.native

    @arc4.abimethod()
    def set_orchestrator(self, address: arc4.Address) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.orchestrator = address.native

    @arc4.abimethod()
    def set_escrow(self, app_id: arc4.UInt64) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.escrow_app_id = app_id.native

    @arc4.abimethod()
    def pause(self) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.paused = UInt64(1)

    @arc4.abimethod()
    def unpause(self) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.paused = UInt64(0)

    # ── INTERNAL SUBROUTINES ──────────────────────────────────────

    @subroutine
    def _calc_maturity(self, days: UInt64) -> UInt64:
        """Calculate maturity timestamp based on demo/production mode."""
        if self.demo_mode == UInt64(1):
            # Demo: each day is demo_multiplier seconds
            # e.g. 30D * 60s = 1800s = 30 minutes
            return Global.latest_timestamp + (days * self.demo_multiplier)
        else:
            # Production: days * 86400 seconds
            return Global.latest_timestamp + (days * UInt64(86400))

    @subroutine
    def _calc_yield(self, principal: UInt64, days: UInt64) -> UInt64:
        """
        yield = principal * rate_bps * days / (365 * 10000)
        denominator = 3,650,000
        """
        numerator = principal * self.yield_rate_bps * days
        denominator = UInt64(3_650_000)
        if numerator < denominator:
            return UInt64(0)
        return numerator // denominator
