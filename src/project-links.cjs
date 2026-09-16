function projectUrl(shortName, destination) {
  if (typeof shortName !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(shortName)) throw new Error('Invalid project address');
  if (destination === 'site') return `https://${shortName}.webflow.io/`;
  if (destination === 'designer') return `https://webflow.com/design/${shortName}`;
  throw new Error('Unknown project destination');
}
module.exports = { projectUrl };
