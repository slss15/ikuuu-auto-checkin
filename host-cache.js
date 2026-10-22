import { readFileSync, writeFileSync } from "fs";

const CACHE_FILE = process.env.IKUUU_HOST_CACHE || ".ikuuu-host";
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export function readCachedHost() {
  try {
    const host = readFileSync(CACHE_FILE, "utf8").trim();

    return HOST_PATTERN.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function saveCachedHost(host) {
  if (!HOST_PATTERN.test(host)) {
    return;
  }

  try {
    writeFileSync(CACHE_FILE, `${host}\n`);
  } catch (error) {
    console.warn(`⚠️ 保存域名缓存失败: ${error.message}`);
  }
}
