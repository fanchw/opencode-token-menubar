# Telegram Bot API 参考

## 官方文档

- **Bot API 完整文档**：https://core.telegram.org/bots/api
- **Bot 入门（如何创建 bot）**：https://core.telegram.org/bots#how-do-bots-work
- **BotFather**（创建 bot、获取 token）：https://t.me/BotFather

## URL 格式

```
https://api.telegram.org/bot<token>/METHOD_NAME
```

**关键**：`bot` 和 `<token>` 之间**没有斜杠**。

例：
```
https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/getMe
```

Token 格式：`数字:字母数字混合`（如 `123456:ABC-DEF...`）。

## 本项目使用的 API 方法

| 方法 | 用途 | 关键参数 | 返回 |
|---|---|---|---|
| `getMe` | 校验 token | 无 | `User`（id, username, is_bot） |
| `setMyCommands` | 注册命令菜单 | `{ commands: [{command, description}] }` | `True` |
| `getUpdates` | 长轮询收消息 | `{ offset, timeout, limit?, allowed_updates? }` | `Array<Update>` |
| `answerCallbackQuery` | 应答按钮回调 | `{ callback_query_id }` — 用 `callback_query.id` 不是 `from.id` | `True` |
| `sendMessage` | 发送消息 | `{ chat_id, text, reply_markup? }` | `Message`（message_id） |
| `editMessageText` | 编辑消息 | `{ chat_id, message_id, text }` | `Message` |

## 关键类型

### Update
```
update_id: Integer
message?: Message
callback_query?: CallbackQuery
```

### CallbackQuery
```
id: String          ← answerCallbackQuery 用这个，不是 from.id
from: User
data?: String       ← inline keyboard 的 callback_data
message: Message    ← 按钮所在消息
```

### InlineKeyboardMarkup
```
inline_keyboard: Array<Array<{
  text: String
  callback_data?: String   ← 最大 64 字节
}>>
```

## 响应格式

```json
{ "ok": true, "result": ... }       // 成功
{ "ok": false, "description": "..." } // 失败
```

## 限制

- 单条消息文本上限：4096 字符
- callback_data 上限：64 字节
- getUpdates timeout 是秒（长轮询），建议 30s
- 速率限制：同一聊天每秒约 1 条，同一消息 editMessageText 更严

## 代理（中国大陆网络）

`api.telegram.org` 需要代理访问。本项目用 undici `ProxyAgent`：
- 配置文件 `"proxy": "http://127.0.0.1:7890"` 或 `HTTPS_PROXY` 环境变量
- 有代理时用 undici 自己的 fetch（版本匹配），无代理用全局 fetch
