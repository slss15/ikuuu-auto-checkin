const TRAFFIC_PATTERN = /(\d+(?:\.\d+)?)\s*([KMGT]i?B)/i;
const AUTH_PATTERN =
  /未登录|请登录|请先登录|登录失效|登录已失效|重新登录|cookie|unauthorized|forbidden/i;
const ALREADY_PATTERN = /已经签到|已签到|already/i;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index === 0 ? 0 : 2)}${units[index]}`;
}

function normalizeTraffic(value) {
  if (typeof value === "number") {
    return formatBytes(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    return formatBytes(Number(text));
  }

  const match = text.match(/^(\d+(?:\.\d+)?)\s*([KMGT]i?B)$/i);

  return match ? `${match[1]}${match[2].toUpperCase()}` : text;
}

export function extractGainedTraffic(message) {
  const match = String(message || "").match(TRAFFIC_PATTERN);

  return match ? `${match[1]}${match[2].toUpperCase()}` : null;
}

export function extractRemainingTraffic(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return (
    normalizeTraffic(data.traffic) ||
    normalizeTraffic(data.trafficInfo?.unUsedTraffic) ||
    normalizeTraffic(data.unflowtraffic) ||
    null
  );
}

function isAuthPage(response, body) {
  if (/\/auth\/login/i.test(response.url || "")) {
    return true;
  }

  return (
    /name=["']email["']/i.test(body) &&
    /action=["'][^"']*\/auth\/login/i.test(body)
  );
}

async function fetchRemainingTraffic(host, cookie) {
  try {
    const response = await fetch(`https://${host}/user`, {
      headers: { Cookie: cookie },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return null;
    }

    let html = await response.text();
    const encoded = html.match(/var originBody = "([^"]+)"/);

    if (encoded) {
      try {
        html = Buffer.from(encoded[1], "base64").toString("utf8");
      } catch {}
    }

    const patterns = [
      /剩余流量[\s\S]{0,800}?class=["'][^"']*counter[^"']*["'][^>]*>\s*([\d.]+)\s*<\/span>[\s\S]{0,100}?([KMGT]i?B)/i,
      /剩余流量[^0-9]{0,100}([\d.]+)\s*([KMGT]i?B)/i,
      /unUsedTraffic["']?\s*[:=]\s*["']?([\d.]+)\s*([KMGT]i?B)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match) {
        return `${match[1]}${match[2].toUpperCase()}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function checkIn(account, host) {
  const url = `https://${host}/user/checkin`;

  let response;
  let body;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: account.cookie,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    body = await response.text();
  } catch (error) {
    return {
      host,
      ok: false,
      kind: "host",
      message: `网络请求失败 - ${error.message}`,
    };
  }

  let finalHost = host;

  try {
    finalHost = new URL(response.url).hostname;
  } catch {}

  let data;

  try {
    data = JSON.parse(body);
  } catch {}

  if (!data || typeof data !== "object") {
    const authPage = finalHost === host && isAuthPage(response, body);

    return {
      host,
      ok: false,
      kind: authPage ? "auth" : "host",
      message: authPage
        ? "Cookie 已失效，请重新获取"
        : finalHost !== host
          ? `域名重定向至 ${finalHost}`
          : `签到响应格式错误 - ${response.status}`,
    };
  }

  const message = data.msg || `网络请求出错 - ${response.status}`;

  if (!response.ok) {
    const authFailure =
      finalHost === host &&
      (AUTH_PATTERN.test(message) || response.status === 401);

    return {
      host,
      ok: false,
      kind:
        finalHost !== host
          ? "host"
          : authFailure
            ? "auth"
            : response.status >= 500
              ? "host"
              : "api",
      message,
    };
  }

  const already = ALREADY_PATTERN.test(message);
  const ok = Number(data.ret) === 1 || already;
  const gained = already ? "0B" : extractGainedTraffic(message);
  let remaining = extractRemainingTraffic(data);

  if (ok && !remaining) {
    remaining = await fetchRemainingTraffic(finalHost, account.cookie);
  }

  if (ok) {
    return {
      host,
      ok: true,
      kind: "ok",
      already,
      message,
      gained,
      remaining,
    };
  }

  const authFailure = finalHost === host && AUTH_PATTERN.test(message);

  return {
    host,
    ok: false,
    kind: authFailure ? "auth" : finalHost !== host ? "host" : "api",
    message,
  };
}
