import nodemailer from "nodemailer";

export function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

export function createTransport() {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

export async function sendEmail(subject, text) {
  if (!hasSmtpConfig()) {
    return false;
  }

  const transporter = createTransport();

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO || process.env.SMTP_USER,
      subject,
      text,
    });
    console.log("邮件通知已发送。");
    return true;
  } catch (error) {
    console.warn(`⚠️ 邮件通知发送失败: ${error.message}`);
    return false;
  } finally {
    transporter.close();
  }
}
