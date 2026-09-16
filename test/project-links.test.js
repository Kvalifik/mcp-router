import test from 'node:test';
import assert from 'node:assert/strict';
import links from '../src/project-links.cjs';
test('project links only open fixed HTTPS Webflow destinations',()=>{
 assert.equal(links.projectUrl('my-site','site'),'https://my-site.webflow.io/');
 assert.equal(links.projectUrl('my-site','designer'),'https://webflow.com/design/my-site');
 for(const slug of ['../x','evil.com/','x@evil.com','https://evil.com','',null])assert.throws(()=>links.projectUrl(slug,'site'));
 assert.throws(()=>links.projectUrl('my-site','shell'));
});
