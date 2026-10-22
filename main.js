import { appendFileSync } from "fs";

import { checkIn } from "./checkin.js";
import { discoverLatestHost } from "./discover.js";
import { readCachedHost, saveCachedHost } from "./host-cache.js";
import { sendEmail } from "./mailer.js";

let host = readCachedHost() || process.env.HOST || "ikuuu.win";

function setGitHubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<EOF\n${value}\nEOF\n`);
}

function parseUids(value) {
  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.map((uid) => String(uid).trim()).filter(Boolean);
    }
  } catch {}

  return value
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean);
}

async function notifyWxPusher(summary, content) {
  const spt = process.env.WXPUSHER_SPT;
  const appToken = process.env.WXPUSHER_APP_TOKEN;
  const uids = process.env.WXPUSHER_UIDS;

  let url;
  let payload;

  if (spt) {
    url = "https://wxpusher.zjiecode.com/api/send/message/simple-push";
    payload = { spt, content, summary, contentType: 1 };
  } else if (appToken && uids) {
    url = "https://wxpusher.zjiecode.com/api/send/message";
    payload = {
      appToken,
      content,
      summary,
      contentType: 1,
      uids: parseUids(uids),
    };
  } else {
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.code !== 1000) {
      throw new Error(`WxPusher 推送失败 - ${data?.msg || response.status}`);
    }

    console.log("WxPusher 通知已发送。");
  } catch (error) {
    console.error(error.message);
  }
}

async function runAccounts(accounts, targetHost) {
  const settled = await Promise.allSettled(
    accounts.map((account) => checkIn(account, targetHost)),
  );

  return settled.map((item, index) => {
    if (item.status === "fulfilled") {
      return { ...item.value, account: accounts[index] };
    }

    return {
      host: targetHost,
      account: accounts[index],
      ok: false,
      kind: "api",
      message: item.reason?.message || "未知错误",
    };
  });
}

function formatResult(result) {
  const name = result.account.name || "未命名账户";

  if (!result.ok) {
    return `${name}: ❌ ${result.message}`;
  }

  if (result.already) {
    return `${name}: ✅ 今日已签到，剩余流量 ${result.remaining || "未知"}`;
  }

  return `${name}: ✅ 获取流量 ${result.gained || "未知"}，剩余流量 ${result.remaining || "未知"}`;
}

function buildEmail(results) {
  const successCount = results.filter((result) => result.ok).length;
  const allSuccess = successCount === results.length;
  const subject = allSuccess
    ? "ikuuu签到成功"
    : successCount === 0
      ? "ikuuu签到失败"
      : "ikuuu签到部分失败";

  if (allSuccess && results.length === 1) {
    const result = results[0];
    const lines = ["iKuuu 签到成功"];

    if (result.already) {
      lines.push("状态: 今日已签到");
    }

    lines.push(`获取流量: ${result.gained || "未知"}`);
    lines.push(`剩余流量: ${result.remaining || "未知"}`);

    return { subject, text: lines.join("\n") };
  }

  const header = allSuccess
    ? "iKuuu 签到成功"
    : successCount === 0
      ? "iKuuu 签到失败"
      : "iKuuu 签到结果";
  const lines = [header, ""];

  for (const result of results) {
    lines.push(`账号: ${result.account.name || "未命名账户"}`);
    lines.push(`域名: ${result.host}`);

    if (result.ok) {
      lines.push(`状态: ${result.already ? "今日已签到" : "签到成功"}`);
      lines.push(`获取流量: ${result.gained || "未知"}`);
      lines.push(`剩余流量: ${result.remaining || "未知"}`);
    } else {
      lines.push("状态: 签到失败");
      lines.push(`原因: ${result.message}`);
    }

    lines.push("");
  }

  return { subject, text: lines.join("\n").trim() };
}

// 入口
async function main() {
  let accounts;

  try {
    if (!process.env.ACCOUNTS) {
      throw new Error("❌ 未配置账户信息。");
    }

    accounts = JSON.parse(process.env.ACCOUNTS);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("未配置账户信息。");
    }
  } catch (error) {
    const message = `❌ ${
      error.message.includes("JSON")
        ? "账户信息配置格式错误。"
        : error.message
    }`;
    console.error(message);
    setGitHubOutput("result", message);
    await sendEmail("ikuuu签到失败", `iKuuu 签到失败\n\n${message}`);
    await notifyWxPusher("ikuuu签到失败", `iKuuu 自动签到\n\n${message}`);
    process.exit(1);
  }

  let results = await runAccounts(accounts, host);

  const hostFailureIndexes = results
    .map((result, index) => (result.kind === "host" ? index : -1))
    .filter((index) => index >= 0);
  const allFailed = results.every((result) => !result.ok);

  if (allFailed && hostFailureIndexes.length > 0) {
    const discovered = await discoverLatestHost();
    let retryHost =
      discovered?.host && discovered.host !== host ? discovered.host : null;

    if (!retryHost) {
      const fallbackHost = process.env.HOST || "ikuuu.win";

      if (fallbackHost !== host) {
        console.log(`↩️ 未发现新域名，回退到 ${fallbackHost}`);
        retryHost = fallbackHost;
      }
    }

    if (retryHost) {
      console.log(`🔄 使用域名重试: ${retryHost}`);

      const retried = await Promise.all(
        hostFailureIndexes.map((index) =>
          checkIn(accounts[index], retryHost).then(
            (result) => ({ ...result, account: accounts[index] }),
            (error) => ({
              host: retryHost,
              account: accounts[index],
              ok: false,
              kind: "api",
              message: error.message,
            }),
          ),
        ),
      );

      hostFailureIndexes.forEach((index, position) => {
        results[index] = retried[position];
      });

      host = retryHost;

      if (retried.some((result) => result.ok) || discovered?.reachable) {
        saveCachedHost(host);
      }
    }
  } else if (results.some((result) => result.ok)) {
    saveCachedHost(host);
  }

  console.log(`使用域名: ${host}`);
  setGitHubOutput("host", host);

  const resultLines = results.map(formatResult);
  const allOk = results.every((result) => result.ok);
  const resultMsg = resultLines.join("\n");

  console.log("\n======== 签到结果 ========\n");
  results.forEach((result, index) => {
    result.ok ? console.log(resultLines[index]) : console.error(resultLines[index]);
  });

  setGitHubOutput("result", resultMsg);

  const actionUrl =
    process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `\n\n任务详情: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "";
  const email = buildEmail(results);

  await sendEmail(email.subject, email.text);
  await notifyWxPusher(
    email.subject,
    `iKuuu 自动签到\n\n${resultMsg}${actionUrl}`,
  );

  if (!allOk) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  const message = `❌ ${error.message}`;

  console.error(message);
  setGitHubOutput("result", message);
  await sendEmail("ikuuu签到失败", `iKuuu 签到失败\n\n${message}`);
  await notifyWxPusher("ikuuu签到失败", `iKuuu 自动签到\n\n${message}`);
  process.exit(1);
});
