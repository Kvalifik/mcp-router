export function projectAuthorized(connection, channel, siteId) {
  const state=connection?.channels?.[channel];
  return !!state?.authorized && !state.inventoryPending && !!state.siteIds?.includes(siteId);
}
