export enum OrderStatus {
  PENDING = 0,
  INVESTED = 1,
  REDEEMED = 2,
  COMPLETED = 3,
  CANCELLED = 4,
  DISPUTED = 5,
}

export enum InvestmentStatus {
  ACTIVE = 0,
  REDEEMED = 1,
  FAILED = 2,
}

export interface OrderRecord {
  buyer: string;
  seller: string;
  amount: number;
  createdAt: number;
  lockUntil: number;
  status: OrderStatus;
  investEligible: boolean;
  yieldEarned: number;
}

export interface InvestmentRecord {
  orderId: number;
  principal: number;
  investedAt: number;
  lockUntil: number;
  redeemedAt: number;
  redeemedAmount: number;
  yieldEarned: number;
  status: InvestmentStatus;
}
