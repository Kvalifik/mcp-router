// Requires sharp (npm install --no-save sharp) and macOS iconutil.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const out = path.resolve(__dirname, '../assets/icons');

// Windows supports PNG-backed ICO entries. Keep each existing RGBA export
// intact and supply the directory used by the executable/resource packager.
function writeWindowsIcon() {
  const sizes = [16,24,32,48,64,128,256];
  const images = sizes.map(size => fs.readFileSync(path.join(out,'png',`mcp-router-${size}.png`)));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2); // Type 1: icon.
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((png, index) => {
    const entry = 6 + 16 * index;
    directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    directory.writeUInt16LE(1, entry + 4); // Colour planes.
    directory.writeUInt16LE(32, entry + 6); // RGBA bits per pixel.
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(out,'MCPRouter.ico'), Buffer.concat([directory, ...images]));
}

async function main() {
  for (const dir of ['png', 'menubar', 'MCPRouter.iconset']) fs.mkdirSync(path.join(out, dir), {recursive:true});
  for (const size of [16,24,32,48,64,128,256,512,1024]) {
    await sharp(path.join(out, 'app-icon.svg'), {density:288}).resize(size,size).png().toFile(path.join(out,'png',`mcp-router-${size}.png`));
  }
  for (const size of [16,32,128,256,512]) for (const scale of [1,2]) {
    fs.copyFileSync(path.join(out,'png',`mcp-router-${size*scale}.png`),path.join(out,'MCPRouter.iconset',`icon_${size}x${size}${scale===2?'@2x':''}.png`));
  }
  for (const scale of [1,2,3]) {
    await sharp(path.join(out, 'mark-menubar.svg'), {density:288}).resize(18*scale,18*scale)
      .extend({top:2*scale,bottom:2*scale,left:2*scale,right:2*scale,background:{r:0,g:0,b:0,alpha:0}})
      .png().toFile(path.join(out,'menubar',`MCPRouterTemplate${scale>1?`@${scale}x`:''}.png`));
  }
  for (const color of ['black','white']) await sharp(path.join(out,`mark-${color}.svg`),{density:288}).resize(1024,1024).png().toFile(path.join(out,`mark-${color}.png`));
  writeWindowsIcon();
  execFileSync('iconutil',['-c','icns',path.join(out,'MCPRouter.iconset'),'-o',path.join(out,'MCPRouter.icns')],{stdio:'inherit'});
  console.log('Exported macOS, Windows, PNG, monochrome and normal menu-bar icons.');
}
main().catch(error=>{console.error(error);process.exit(1)});
