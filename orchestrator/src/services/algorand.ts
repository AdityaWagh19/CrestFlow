/**
 * Algorand Service - Low-level Algorand interactions
 */
import algosdk from "algosdk";
import { algodClient, orchestratorAccount } from "../config";
import * as logger from "../utils/logger";

export async function getCurrentRound(): Promise<number> {
  const status = await algodClient.status().do();
  return Number(status["lastRound"]);
}

export async function sendPayment(receiver: string, amountMicroAlgo: number): Promise<string> {
  const sp = await algodClient.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: orchestratorAccount.addr.toString(),
    receiver,
    amount: BigInt(amountMicroAlgo),
    suggestedParams: sp,
  });
  const signed = txn.signTxn(orchestratorAccount.sk);
  const { txid } = await algodClient.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algodClient, txid, 4);
  logger.info(`Payment sent: ${amountMicroAlgo / 1e6} ALGO -> ${receiver.slice(0, 12)}... (tx: ${txid})`);
  return txid;
}

export async function getAccountBalance(addr: string): Promise<number> {
  const info = await algodClient.accountInformation(addr).do();
  return Number(info["amount"]);
}

export async function callABI(
  appId: number,
  methodSig: string,
  args: any[],
  boxes?: { appIndex: number; name: Uint8Array }[],
  fee: number = 2000,
  accounts?: string[]
): Promise<algosdk.ABIResult> {
  const method = algosdk.ABIMethod.fromSignature(methodSig);
  const sp = await algodClient.getTransactionParams().do();
  sp.fee = BigInt(fee);
  sp.flatFee = true;

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: appId,
    method,
    sender: orchestratorAccount.addr.toString(),
    suggestedParams: sp,
    signer: algosdk.makeBasicAccountTransactionSigner(orchestratorAccount),
    methodArgs: args,
    boxes: boxes || [],
    appAccounts: accounts || [],
  });

  const result = await atc.execute(algodClient, 4);
  return result.methodResults[0];
}

export async function callABIWithPayment(
  appId: number,
  methodSig: string,
  paymentAmount: number,
  paymentReceiver: string,
  args: any[],
  boxes?: { appIndex: number; name: Uint8Array }[]
): Promise<algosdk.ABIResult> {
  const method = algosdk.ABIMethod.fromSignature(methodSig);
  const sp = await algodClient.getTransactionParams().do();
  sp.fee = BigInt(2000);
  sp.flatFee = true;

  const atc = new algosdk.AtomicTransactionComposer();

  const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: orchestratorAccount.addr.toString(),
    receiver: paymentReceiver,
    amount: BigInt(paymentAmount),
    suggestedParams: sp,
  });

  atc.addMethodCall({
    appID: appId,
    method,
    sender: orchestratorAccount.addr.toString(),
    suggestedParams: { ...sp, fee: BigInt(3000) },
    signer: algosdk.makeBasicAccountTransactionSigner(orchestratorAccount),
    methodArgs: [
      { txn: payTxn, signer: algosdk.makeBasicAccountTransactionSigner(orchestratorAccount) },
      ...args,
    ],
    boxes: boxes || [],
  });

  const result = await atc.execute(algodClient, 4);
  return result.methodResults[0];
}
