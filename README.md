## iKuuu 定时自动签到

> 利用 Github Actions 实现自动签到，支持多账户、域名自动发现与缓存、邮件 / Telegram / WxPusher 通知。

[![IKUUU-Auto-Checkin](https://github.com/ewigl/ikuuu-auto-checkin/actions/workflows/Checkin.yml/badge.svg)](https://github.com/ewigl/ikuuu-auto-checkin/actions/workflows/Checkin.yml)

### 仓库变量

- **ACCOUNTS**：账户信息，账户配置示例如下。推荐使用 [JSON 格式化工具](https://jsoneditoronline.org/) 进行编辑以避免格式出错。

  ```json
  [
    {
      "name": "这里填写账户备注",
      "cookie": "这里填写 Cookie"
    },
    {
      "name": "这里填写账户备注",
      "cookie": "只有一个账号可以删除这一条{}记录，有两个以上账号自行在下方添加新的{}记录。"
    }
  ]
  ```

- **HOST**: iKuuu 的域名，不设置时默认为 `ikuuu.win`。脚本会保存最近探测到的域名，只有全部账号签到失败且疑似域名问题时才进行下一次域名探测；`HOST` 作为首次运行和探测失败时的回退值。
- **TELEGRAM_TOKEN**: （可选）Telegram 通知的 Bot Token。
- **TELEGRAM_TO**: （可选）Telegram 通知的 Chat ID。
- **WXPUSHER_SPT**: （可选）WxPusher [极简推送](https://wxpusher.zjiecode.com/docs/#/spt) 的 SPT，以 `SPT_` 开头。只需配置此项，推荐个人使用。
- **WXPUSHER_APP_TOKEN**: （可选）WxPusher [标准推送](https://wxpusher.zjiecode.com/docs/#/api-reference) 的应用 appToken，以 `AT_` 开头。与 `WXPUSHER_UIDS` 搭配使用。
- **WXPUSHER_UIDS**: （可选）接收消息的 UID，多个以英文逗号分隔。

> WxPusher 通知只需配置 `WXPUSHER_SPT`，或同时配置 `WXPUSHER_APP_TOKEN` 与 `WXPUSHER_UIDS`；都未配置时自动跳过。

- **SMTP_HOST**: （可选）发信邮箱的 SMTP 服务器，例如 `smtp.qq.com`。
- **SMTP_PORT**: （可选）SMTP 端口，默认 `465`。
- **SMTP_SECURE**: （可选）是否使用 SSL，默认端口 `465` 时为 `true`，`587` 时为 `false`。
- **SMTP_USER**: （可选）SMTP 账号。
- **SMTP_PASS**: （可选）SMTP 密码或授权码。
- **SMTP_FROM**: （可选）发件人地址，默认与 `SMTP_USER` 相同。
- **MAIL_TO**: （可选）接收通知邮件的地址，默认与 `SMTP_USER` 相同。
- **IMAP_HOST**: （可选）IMAP 服务器，配置后可在签到失败时自动发现域名。
- **IMAP_PORT**: （可选）IMAP 端口，默认 `993`。
- **IMAP_SECURE**: （可选）是否使用 SSL，默认 `true`。
- **IMAP_USER**: （可选）IMAP 账号，默认与 `SMTP_USER` 相同。
- **IMAP_PASS**: （可选）IMAP 密码或授权码，默认与 `SMTP_PASS` 相同。
- **IMAP_MAILBOX**: （可选）收件箱名称，默认 `INBOX`。
- **IKUUU_FIND_ADDRESS**: （可选）自动回复地址，默认 `find@ikuuu.pro`。
- **IKUUU_DISCOVERY_TIMEOUT**: （可选）等待自动回复的秒数，默认 `120`。

> 域名自动发现只在签到失败时触发：最近探测到的域名保存在 `.ikuuu-host`（通过 Actions Cache 持久化），签到成功时直接复用；失败后才通过 SMTP 向 `find@ikuuu.pro` 发送邮件，并用 IMAP 读取自动回复中的最新域名。需要用同一个邮箱收发（例如 SMTP `mail.mail.nodeloc.cc:587` STARTTLS、IMAP `mail.mail.nodeloc.cc:993` SSL，账号填写完整邮箱地址，密码填写应用密码）。探测失败时回退到 `HOST`（未设置时为 `ikuuu.win`）。
>
> 配置 SMTP 后会同时发送邮件通知：全部成功时主题为 `ikuuu签到成功`，正文包含获取流量和剩余流量；Cookie 失效等失败时主题为 `ikuuu签到失败`。

### 使用方法

0. 获取 Cookie：登录 iKuuu 后打开开发者工具，在控制台中输入 `document.cookie`，回车后复制输出的内容（不包含引号）作为 Cookie。

1. Fork 此仓库。
2. 在 fork 后的仓库中启用 Actions。
3. 配置仓库变量。

详细文档: https://ewigl.github.io/projects/github-actions-tasks/

### 注意事项

根据 [Github 的政策](https://docs.github.com/zh/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow?tool=webui)，当 60 天内未发生仓库活动时，将自动禁用定时 Workflow。需要再次手动启用。
