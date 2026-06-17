import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";

export interface SessionSummary {
  id: string;
  title?: string;
}

export class OpenCodeProxy {
  constructor(private client: OpencodeClient) {}

  static fromBaseUrl(baseUrl: string): OpenCodeProxy {
    return new OpenCodeProxy(createOpencodeClient({ baseUrl }));
  }

  async createSession(): Promise<string> {
    const res = await this.client.session.create();
    return res.data!.id;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.client.session.list();
    return (res.data ?? []) as SessionSummary[];
  }

  async getSession(id: string) {
    const res = await this.client.session.get({ path: { id } });
    return res.data;
  }

  async abort(id: string): Promise<void> {
    await this.client.session.abort({ path: { id } });
  }

  async promptAsync(id: string, text: string): Promise<void> {
    await this.client.session.promptAsync({
      path: { id },
      body: { parts: [{ type: "text" as const, text }] },
    });
  }

  // 权限响应：三态（once=本次允许 / always=永久允许 / reject=拒绝）
  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
    });
  }
}
