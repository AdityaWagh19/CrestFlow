"""
Cadencia Treasury - Escrow Contract
Handles order lifecycle: buyer locks ALGO, seller gets paid on completion.
Integrates with Treasury contract for yield tracking.
"""

from algopy import (
    ARC4Contract, BoxMap, Global, Txn, UInt64, arc4, gtxn, itxn,
)

# Order status constants
PENDING = 0
INVESTED = 1
REDEEMED = 2
COMPLETED = 3
CANCELLED = 4
DISPUTED = 5


class OrderRecord(arc4.Struct):
    buyer: arc4.Address
    seller: arc4.Address
    amount: arc4.UInt64           # microALGO locked
    created_at: arc4.UInt64       # round
    lock_until: arc4.UInt64       # round for auto-redeem
    status: arc4.UInt8            # OrderStatus enum
    invest_eligible: arc4.Bool    # True if amount >= min threshold
    yield_earned: arc4.UInt64     # actual yield (filled on redemption)


class EscrowStats(arc4.Struct):
    total_locked: arc4.UInt64
    total_released: arc4.UInt64
    total_orders: arc4.UInt64
    active_orders: arc4.UInt64


class CadenciaEscrow(ARC4Contract):

    def __init__(self) -> None:
        self.admin = Global.creator_address
        self.treasury_app_id = UInt64(0)
        self.treasury_address = Global.zero_address
        self.platform_wallet = Global.zero_address
        self.total_locked = UInt64(0)
        self.total_released = UInt64(0)
        self.total_orders = UInt64(0)
        self.active_orders = UInt64(0)
        self.min_order_amount = UInt64(5_000_000)  # 5 ALGO
        self.default_lock_duration = UInt64(100)    # ~5 min
        self.paused = UInt64(0)
        self.orders = BoxMap(arc4.UInt64, OrderRecord)

    # -- ORDER LIFECYCLE --

    @arc4.abimethod()
    def create_order(
        self,
        pay_txn: gtxn.PaymentTransaction,
        seller: arc4.Address,
        order_id: arc4.UInt64,
        lock_duration: arc4.UInt64,
    ) -> None:
        assert self.paused == UInt64(0), "ESCROW_PAUSED"
        assert pay_txn.receiver == Global.current_application_address, "INVALID_PAYMENT"
        assert pay_txn.amount > UInt64(0), "ZERO_AMOUNT"
        assert seller.native != pay_txn.sender, "SELF_ORDER"
        assert order_id not in self.orders, "DUPLICATE_ORDER"

        amount = pay_txn.amount
        eligible = amount >= self.min_order_amount

        duration = lock_duration.native
        if duration == UInt64(0):
            duration = self.default_lock_duration

        self.orders[order_id] = OrderRecord(
            buyer=arc4.Address(pay_txn.sender),
            seller=seller,
            amount=arc4.UInt64(amount),
            created_at=arc4.UInt64(Global.round),
            lock_until=arc4.UInt64(Global.round + duration),
            status=arc4.UInt8(PENDING),
            invest_eligible=arc4.Bool(eligible),
            yield_earned=arc4.UInt64(0),
        )
        self.total_locked += amount
        self.total_orders += UInt64(1)
        self.active_orders += UInt64(1)

    @arc4.abimethod()
    def mark_invested(self, order_id: arc4.UInt64) -> None:
        assert Txn.sender == self.treasury_address, "UNAUTHORIZED"
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        order = self.orders[order_id].copy()
        assert order.status == arc4.UInt8(PENDING), "INVALID_STATUS"
        assert order.invest_eligible == arc4.Bool(True), "NOT_ELIGIBLE"
        self.orders[order_id] = OrderRecord(
            buyer=order.buyer, seller=order.seller, amount=order.amount,
            created_at=order.created_at, lock_until=order.lock_until,
            status=arc4.UInt8(INVESTED),
            invest_eligible=order.invest_eligible, yield_earned=order.yield_earned,
        )

    @arc4.abimethod()
    def mark_redeemed(self, order_id: arc4.UInt64, yield_earned: arc4.UInt64) -> None:
        assert Txn.sender == self.treasury_address, "UNAUTHORIZED"
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        order = self.orders[order_id].copy()
        assert order.status == arc4.UInt8(INVESTED), "INVALID_STATUS"
        self.orders[order_id] = OrderRecord(
            buyer=order.buyer, seller=order.seller, amount=order.amount,
            created_at=order.created_at, lock_until=order.lock_until,
            status=arc4.UInt8(REDEEMED),
            invest_eligible=order.invest_eligible, yield_earned=yield_earned,
        )

    @arc4.abimethod()
    def complete_order(self, order_id: arc4.UInt64) -> None:
        # Admin OR orchestrator (treasury_address) may auto-complete.
        # Note: use explicit if/else — Python 'or' short-circuits AlgoPy Bool objects.
        if Txn.sender != self.admin:
            assert Txn.sender == self.treasury_address, "UNAUTHORIZED"
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        order = self.orders[order_id].copy()

        if order.invest_eligible == arc4.Bool(False):
            # Sub-threshold: direct release
            assert order.status == arc4.UInt8(PENDING), "INVALID_STATUS"
            itxn.Payment(
                receiver=order.seller.native,
                amount=order.amount.native,
                fee=UInt64(0),
            ).submit()
        else:
            # Was invested: must be redeemed first
            assert order.status == arc4.UInt8(REDEEMED), "STILL_INVESTED"
            itxn.Payment(
                receiver=order.seller.native,
                amount=order.amount.native,
                fee=UInt64(0),
            ).submit()
            if order.yield_earned.native > UInt64(0):
                itxn.Payment(
                    receiver=self.platform_wallet,
                    amount=order.yield_earned.native,
                    fee=UInt64(0),
                ).submit()

        self.orders[order_id] = OrderRecord(
            buyer=order.buyer, seller=order.seller, amount=order.amount,
            created_at=order.created_at, lock_until=order.lock_until,
            status=arc4.UInt8(COMPLETED),
            invest_eligible=order.invest_eligible, yield_earned=order.yield_earned,
        )
        self.total_locked -= order.amount.native
        self.active_orders -= UInt64(1)
        self.total_released += order.amount.native

    @arc4.abimethod()
    def cancel_order(self, order_id: arc4.UInt64) -> None:
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        order = self.orders[order_id].copy()
        assert Txn.sender == self.admin or Txn.sender == order.buyer.native, "UNAUTHORIZED"

        if order.invest_eligible == arc4.Bool(False):
            assert order.status == arc4.UInt8(PENDING), "INVALID_STATUS"
            itxn.Payment(
                receiver=order.buyer.native,
                amount=order.amount.native,
                fee=UInt64(0),
            ).submit()
        else:
            assert order.status == arc4.UInt8(REDEEMED), "STILL_INVESTED"
            itxn.Payment(
                receiver=order.buyer.native,
                amount=order.amount.native,
                fee=UInt64(0),
            ).submit()
            if order.yield_earned.native > UInt64(0):
                itxn.Payment(
                    receiver=self.platform_wallet,
                    amount=order.yield_earned.native,
                    fee=UInt64(0),
                ).submit()

        self.orders[order_id] = OrderRecord(
            buyer=order.buyer, seller=order.seller, amount=order.amount,
            created_at=order.created_at, lock_until=order.lock_until,
            status=arc4.UInt8(CANCELLED),
            invest_eligible=order.invest_eligible, yield_earned=order.yield_earned,
        )
        self.total_locked -= order.amount.native
        self.active_orders -= UInt64(1)

    # -- ORCHESTRATOR FUND MANAGEMENT --

    @arc4.abimethod()
    def transfer_to_treasury(self, order_id: arc4.UInt64) -> None:
        """Transfer ALGO from escrow to orchestrator for investment."""
        assert Txn.sender == self.treasury_address, "UNAUTHORIZED"
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        order = self.orders[order_id].copy()
        assert order.status == arc4.UInt8(PENDING), "INVALID_STATUS"
        assert order.invest_eligible == arc4.Bool(True), "NOT_ELIGIBLE"
        itxn.Payment(
            receiver=self.treasury_address,
            amount=order.amount.native,
            fee=UInt64(0),
        ).submit()

    @arc4.abimethod()
    def receive_from_treasury(self, pay_txn: gtxn.PaymentTransaction, order_id: arc4.UInt64) -> None:
        """Receive ALGO back from orchestrator after redemption."""
        assert Txn.sender == self.treasury_address, "UNAUTHORIZED"
        assert pay_txn.receiver == Global.current_application_address, "INVALID_PAYMENT"
        assert order_id in self.orders, "ORDER_NOT_FOUND"

    # -- READ-ONLY --

    @arc4.abimethod(readonly=True)
    def get_order(self, order_id: arc4.UInt64) -> OrderRecord:
        assert order_id in self.orders, "ORDER_NOT_FOUND"
        return self.orders[order_id].copy()

    @arc4.abimethod(readonly=True)
    def get_escrow_stats(self) -> EscrowStats:
        return EscrowStats(
            total_locked=arc4.UInt64(self.total_locked),
            total_released=arc4.UInt64(self.total_released),
            total_orders=arc4.UInt64(self.total_orders),
            active_orders=arc4.UInt64(self.active_orders),
        )

    @arc4.abimethod(readonly=True)
    def is_paused(self) -> arc4.Bool:
        return arc4.Bool(self.paused == UInt64(1))

    # -- ADMIN --

    @arc4.abimethod()
    def set_treasury(self, app_id: arc4.UInt64, address: arc4.Address) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.treasury_app_id = app_id.native
        self.treasury_address = address.native

    @arc4.abimethod()
    def set_platform_wallet(self, address: arc4.Address) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.platform_wallet = address.native

    @arc4.abimethod()
    def set_min_order(self, amount: arc4.UInt64) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.min_order_amount = amount.native

    @arc4.abimethod()
    def set_default_lock(self, duration: arc4.UInt64) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.default_lock_duration = duration.native

    @arc4.abimethod()
    def pause(self) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.paused = UInt64(1)

    @arc4.abimethod()
    def unpause(self) -> None:
        assert Txn.sender == self.admin, "UNAUTHORIZED"
        self.paused = UInt64(0)
