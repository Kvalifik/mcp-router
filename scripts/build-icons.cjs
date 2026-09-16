// Requires sharp (npm install --no-save sharp) and macOS iconutil.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const out = path.resolve(__dirname, '../assets/icons');
async function main() {
  for (const dir of ['png', 'menubar', 'MCPRouter.iconset']) fs.mkdirSync(path.join(out, dir), {recursive:true});
  for (const size of [16,24,32,48,64,128,256,512,1024]) {
    await sharp(path.join(out, 'app-icon.svg'), {density:288}).resize(size,size).png().toFile(path.join(out,'png',`mcp-router-${size}.png`));
  }
  for (const size of [16,32,128,256,512]) for (const scale of [1,2]) {
    fs.copyFileSync(path.join(out,'png',`mcp-router-${size*scale}.png`),path.join(out,'MCPRouter.iconset',`icon_${size}x${size}${scale===2?'@2x':''}.png`));
  }
  for (const scale of [1,2,3]) {
    await sharp(path.join(out, 'mark-black.svg'), {density:288}).resize(18*scale,18*scale)
      .extend({top:2*scale,bottom:2*scale,left:2*scale,right:2*scale,background:{r:0,g:0,b:0,alpha:0}})
      .png().toFile(path.join(out,'menubar',`MCPRouterTemplate${scale>1?`@${scale}x`:''}.png`));
  }
  for (const color of ['black','white']) await sharp(path.join(out,`mark-${color}.svg`),{density:288}).resize(1024,1024).png().toFile(path.join(out,`mark-${color}.png`));
  execFileSync('iconutil',['-c','icns',path.join(out,'MCPRouter.iconset'),'-o',path.join(out,'MCPRouter.icns')],{stdio:'inherit'});
  console.log('Exported app, monochrome and menu-bar icons.');
}
main().catch(error=>{console.error(error);process.exit(1)});
