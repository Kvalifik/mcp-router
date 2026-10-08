// Only errors constructed here may cross the local MCP boundary with details.
export class AgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.feedback = { code, message, ...details };
  }
}
export function authorizationRequired(message = 'Webflow authorization is required for the selected MCP channel.') {
  return new AgentError('reauthorization_required', message, {
    nextStep: 'Call request_reauthorization with this projectId and show the returned link to the user. Ask them to include this project and all other projects that should retain access. The user must complete Webflow authorization. Do not switch grants.',
  });
}
export function upstreamError(error) {
  if (error instanceof AgentError) return error;
  if (['UnauthorizedError', 'InvalidGrantError', 'InvalidTokenError'].includes(error?.constructor?.name) || error?.code === 401 || error?.status === 401 || error?.statusCode === 401)
    return authorizationRequired();
  if (error?.constructor?.name === 'InvalidScopeError' || error?.code === 'missing_scopes' || error?.code === 'insufficient_scope')
    return authorizationRequired('Webflow reported missing OAuth permissions. Reauthorize the selected grant with the required access.');
  if (error?.code === 403 || error?.status === 403 || error?.statusCode === 403)
    return new AgentError('upstream_access_denied', 'Webflow denied access. This does not confirm that reauthorization will fix it.', {nextStep:'Check the user’s Webflow role and access requirements. Use request_reauthorization only if the grant needs updating.'});
  return new AgentError('upstream_failure', 'Operation failed or resource ownership could not be verified. The cause is unknown.', {nextStep:'Check connection status and Webflow requirements. Do not assume reauthorization is needed. Do not automatically retry a write; inspect whether it completed first.'});
}
export function checkUpstreamResponse(response) {
  const failures = [];
  for (const part of response?.content || []) {
    if (part.type !== 'text') continue;
    let parsed; try { parsed = JSON.parse(part.text); } catch { continue; }
    for (const block of Array.isArray(parsed) ? parsed : [parsed]) {
      if (block?.error) failures.push(block.error);
      else if (response?.isError && block && typeof block === 'object') failures.push(block);
    }
  }
  if (!response?.isError && !failures.length) return response;
  // Inspect only structured error fields, never reflect provider messages or data.
  const errors = failures.map(upstreamError);
  throw errors.find(error => error.feedback.code === 'reauthorization_required') || errors.find(error => error.feedback.code === 'upstream_access_denied') || upstreamError();
}
const localErrors = new Map([
  ['Run prepare_project and read its instructions before writing', 'preparation_required'],
  ['Project policy changed during request', 'project_policy_changed'],
  ['Project mapping changed during request', 'project_policy_changed'],
  ['Resource does not belong to this project', 'resource_access_denied'],
  ['Cross-project site denied', 'resource_access_denied'],
  ['Unknown operation', 'invalid_operation'],
  ['Parameters do not match the operation schema', 'invalid_arguments'],
  ['Invalid operation parameters', 'invalid_arguments'],
  ['Invalid arguments', 'invalid_arguments'],
  ['pageId is required', 'invalid_arguments'],
  ['Wrong execution tool. Use read_webflow for this operation.', 'wrong_execution_tool'],
  ['Wrong execution tool. Use write_webflow for this operation.', 'wrong_execution_tool'],
]);
export function agentFeedback(error) {
  if (error instanceof AgentError) return error.feedback;
  // Exact router-authored messages only; never forward arbitrary exception text.
  if (localErrors.has(error?.message)) return {code:localErrors.get(error.message),message:error.message};
  return {
    code:'request_failed', message:'Request denied or router unavailable.',
    nextStep:'Check the arguments, project access and connection status in MCP Router. Do not assume reauthorization is needed.',
  };
}
