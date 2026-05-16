// Pera Wallet singleton + helpers. Browser-only — never import in loaders.
import { PeraWalletConnect } from "@perawallet/connect";
import algosdk from "algosdk";

// Clear any stale WalletConnect v1 session data that would cause connect() to hang
// trying to kill an old session against a dead/unreachable bridge.
function clearStalePeraSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("walletconnect");
    localStorage.removeItem("PeraWallet.Wallet");
  } catch {}
}

let _pera: PeraWalletConnect | null = null;

export function getPera(): PeraWalletConnect {
  if (!_pera) _pera = new PeraWalletConnect();
  return _pera;
}

// Force a fresh instance — called before every new connect attempt so stale
// connector state never causes connect() to hang on killSession().
function getFreshPera(): PeraWalletConnect {
  clearStalePeraSession();
  _pera = new PeraWalletConnect();
  return _pera;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// Wrap a promise with a timeout so a hanging WalletConnect bridge connection
// doesn't leave the button stuck in "Waiting for wallet…" forever.
function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}

export async function connectPera(): Promise<string[]> {
  const pera = getFreshPera();
  return withTimeout(
    pera.connect(),
    30_000,
    "Connection timed out. Make sure Pera Wallet is open and try again."
  );
}

export async function disconnectPera(): Promise<void> {
  try {
    if (_pera) await _pera.disconnect();
  } catch {}
  clearStalePeraSession();
  _pera = null;
}

export async function reconnectPeraSession(): Promise<string[]> {
  try {
    const pera = getPera();
    return await pera.reconnectSession();
  } catch {
    return [];
  }
}

export async function signAuthNonce(address: string, nonceHex: string): Promise<string> {
  const pera = getPera();
  const data = hexToBytes(nonceHex);
  const sig = await pera.signData(
    [{ data: data as any, message: "Login to CrestFlow" }],
    address,
  );
  return bytesToB64(sig[0] as Uint8Array);
}

export async function signOrderTxnGroup(
  unsignedB64: [string, string],
): Promise<[string, string]> {
  const pera = getPera();
  const t0 = algosdk.decodeUnsignedTransaction(b64ToBytes(unsignedB64[0]));
  const t1 = algosdk.decodeUnsignedTransaction(b64ToBytes(unsignedB64[1]));
  const signed = await pera.signTransaction([
    [{ txn: t0 }, { txn: t1 }],
  ]);
  return [bytesToB64(signed[0]), bytesToB64(signed[1])];
}
