const LOG_PREFIX = "[ORCHESTRATOR]";

export function info(msg: string, ...args: any[]) {
  console.log(`${LOG_PREFIX} ${new Date().toISOString()} INFO  ${msg}`, ...args);
}

export function warn(msg: string, ...args: any[]) {
  console.warn(`${LOG_PREFIX} ${new Date().toISOString()} WARN  ${msg}`, ...args);
}

export function error(msg: string, ...args: any[]) {
  console.error(`${LOG_PREFIX} ${new Date().toISOString()} ERROR ${msg}`, ...args);
}
