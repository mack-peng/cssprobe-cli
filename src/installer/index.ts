export { buildSkillMd, buildPitfallsMd } from './skill-template';
export { ALL_TARGETS, getTarget, listTargetIds, resolveTargetFlag } from './targets/registry';
export type { AgentTarget, Location, TargetId, WriteResult } from './targets/types';
export { installMcpConfig, uninstallMcpConfig, listMcpClientIds, MCP_SERVER_NAME } from './mcp';
export type { McpCommandResult, McpFileResult } from './mcp';
