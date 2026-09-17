// Compare project inventories for separately authorized channels.
export function compareGrants(c) {
  if(!c.tokens||!c.beta?.tokens||c.inventoryPending||c.beta.inventoryPending)return null;
  const stable=c.stableSites||c.sites||[],beta=c.beta.sites||[];
  const betaIds=new Set(beta.map(s=>s.id));
  const missingProjects=stable.filter(s=>!betaIds.has(s.id)).map(({id,name})=>({id,name}));
  const workspacesKnown=stable.every(s=>s.workspaceId)&&beta.every(s=>s.workspaceId);
  const betaWorkspaces=new Set(beta.map(s=>s.workspaceId));
  return {missingProjects,missingWorkspaceIds:workspacesKnown?[...new Set(stable.map(s=>s.workspaceId))].filter(id=>!betaWorkspaces.has(id)):null,checkedAt:c.beta.lastChecked||c.lastChecked||null};
}
