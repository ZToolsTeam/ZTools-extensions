/**
 * Organizations 团队数据持久化与协同服务
 * 商业版专属：工作区切换、企业私有扩展、团队共享短语与快捷指令、合规审计
 */
import { OrganizationData, OrgMember, OrgWebhook, TeamSharedQuicklink, ComplianceAuditItem, OrgPermissionPolicy, WorkspaceMode, WorkspaceInfo } from "./types.js";
export declare const ORG_STORAGE_KEY = "ztools_organizations_data_v1";
export declare const INITIAL_ORGANIZATION: OrganizationData;
/**
 * 获取工作区列表元信息
 */
export declare function getAvailableWorkspaces(): WorkspaceInfo[];
/**
 * 切换活跃工作区 (Personal vs Team Enterprise)
 */
export declare function switchWorkspace(mode: WorkspaceMode): Promise<OrganizationData>;
/**
 * 读取当前组织数据 (同步直接可用，亦支持 await)
 */
export declare function getOrganizationData(): OrganizationData & PromiseLike<OrganizationData>;
/**
 * 保存组织数据
 */
export declare function saveOrganizationData(data: OrganizationData): Promise<OrganizationData>;
/**
 * 生成团队邀请链接
 */
export declare function generateInviteLink(org: OrganizationData): string;
/**
 * 添加成员
 */
export declare function addOrgMember(member: Omit<OrgMember, "id" | "joinedAt">): Promise<OrganizationData>;
/**
 * 移除成员
 */
export declare function removeOrgMember(memberId: string): Promise<OrganizationData>;
/**
 * 添加团队共享快捷指令
 */
export declare function addSharedQuicklink(ql: Omit<TeamSharedQuicklink, "id" | "updatedAt">): Promise<OrganizationData>;
/**
 * 移除团队共享快捷指令
 */
export declare function removeSharedQuicklink(id: string): Promise<OrganizationData>;
/**
 * 记录合规审计日志
 */
export declare function recordAuditLog(action: string, actor: string, resource: string, status: "allowed" | "denied" | "flagged", details: string): Promise<ComplianceAuditItem>;
/**
 * 更新团队安全与权限策略
 */
export declare function updateOrgPolicy(policyUpdate: Partial<OrgPermissionPolicy>): Promise<OrganizationData>;
/**
 * 同步团队资产 (Snippets, Quicklinks, Private Extensions)
 */
export declare function syncTeamAssets(): Promise<{
    success: boolean;
    syncedCount: number;
    message: string;
}>;
/**
 * 添加 Webhook
 */
export declare function addOrgWebhook(wh: any): OrganizationData & PromiseLike<OrganizationData>;
/**
 * 删除 Webhook
 */
export declare function removeOrgWebhook(webhookId: string): OrganizationData & PromiseLike<OrganizationData>;
/**
 * 模拟触发 Webhook 联通性测试
 */
export declare function testTriggerWebhook(webhookOrId: OrgWebhook | string): Promise<{
    success: boolean;
    latencyMs: number;
    message: string;
    error?: string;
}>;
