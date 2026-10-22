import { createTransport, hasSmtpConfig } from "./mailer.js";

const DEFAULT_FIND_ADDRESS = "find@ikuuu.pro";
const DEFAULT_TIMEOUT_SECONDS = 120;
const POLL_INTERVAL_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHtml(html) {
  if (Array.isArray(html)) {
    return html.join("\n");
  }

  return typeof html === "string" ? html : "";
}

function extractDomains(...parts) {
  const domains = [];

  for (const part of parts) {
    const matches = String(part || "").matchAll(/ikuuu\.[a-z]{2,}/gi);

    for (const match of matches) {
      const domain = match[0].toLowerCase();

      if (!domains.includes(domain)) {
        domains.push(domain);
      }
    }
  }

  return domains;
}

async function isReachable(domain) {
  try {
    const response = await fetch(`https://${domain}/`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    return response.status < 500;
  } catch {
    return false;
  }
}

async function pickDomain(parts, findAddress) {
  const domains = extractDomains(...parts);
  const excluded = new Set(
    [findAddress.split("@")[1], "ikuuu.club"]
      .filter(Boolean)
      .map((domain) => domain.toLowerCase()),
  );
  const candidates = domains.filter((domain) => !excluded.has(domain));

  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    if (await isReachable(candidate)) {
      console.log(`🌐 自动发现域名: ${candidate}`);
      return { host: candidate, reachable: true };
    }
  }

  console.warn(`⚠️ 候选域名均不可达，尝试使用 ${candidates[0]}。`);
  return { host: candidates[0], reachable: false };
}

async function sendTrigger() {
  const transporter = createTransport();

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.IKUUU_FIND_ADDRESS || DEFAULT_FIND_ADDRESS,
      subject: "ikuuu latest domain",
      text: "Please reply with the latest iKuuu domain.",
    });
  } finally {
    transporter.close();
  }
}

async function waitForImapReply(findAddress, sentAt, deadline) {
  const [{ ImapFlow }, { simpleParser }] = await Promise.all([
    import("imapflow"),
    import("mailparser"),
  ]);

  const port = Number(process.env.IMAP_PORT || 993);
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port,
    secure: process.env.IMAP_SECURE
      ? process.env.IMAP_SECURE === "true"
      : port === 993,
    auth: {
      user: process.env.IMAP_USER || process.env.SMTP_USER,
      pass: process.env.IMAP_PASS || process.env.SMTP_PASS,
    },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || "INBOX");

    try {
      const since = new Date(sentAt - 5 * 60 * 1000);

      while (Date.now() < deadline) {
        const uids = await client.search({ from: findAddress, since }, { uid: true });
        const sorted = [...(uids || [])].sort((a, b) => b - a);

        for (const uid of sorted.slice(0, 5)) {
          const message = await client.fetchOne(
            uid,
            { source: true, internalDate: true },
            { uid: true },
          );

          if (!message?.source) {
            continue;
          }

          const receivedAt = message.internalDate
            ? new Date(message.internalDate).getTime()
            : 0;

          if (receivedAt && receivedAt < sentAt - 5 * 60 * 1000) {
            continue;
          }

          const parsed = await simpleParser(message.source);
          return parsed;
        }

        await sleep(POLL_INTERVAL_MS);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return null;
}

export async function discoverLatestHost() {
  if (!process.env.IMAP_HOST) {
    return null;
  }

  if (!hasSmtpConfig()) {
    console.warn("⚠️ 未配置 SMTP，跳过域名自动发现。");
    return null;
  }

  const findAddress =
    process.env.IKUUU_FIND_ADDRESS || DEFAULT_FIND_ADDRESS;
  const timeoutSeconds = Number(
    process.env.IKUUU_DISCOVERY_TIMEOUT || DEFAULT_TIMEOUT_SECONDS,
  );
  const timeout =
    (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : DEFAULT_TIMEOUT_SECONDS) * 1000;

  try {
    console.log("🔎 正在自动获取 iKuuu 最新域名...");

    const sentAt = Date.now();
    await sendTrigger();

    console.log(`📮 已向 ${findAddress} 发送邮件，等待 IMAP 自动回复...`);

    const mail = await waitForImapReply(findAddress, sentAt, sentAt + timeout);

    if (!mail) {
      console.warn("⚠️ 未收到自动回复，将使用 HOST 回退。");
      return null;
    }

    const discovered = await pickDomain(
      [mail.text, normalizeHtml(mail.html), mail.subject],
      findAddress,
    );

    if (!discovered) {
      console.warn("⚠️ 自动回复中未找到可用域名。");
    }

    return discovered;
  } catch (error) {
    console.warn(`⚠️ 自动获取域名失败: ${error.message}`);
    return null;
  }
}
