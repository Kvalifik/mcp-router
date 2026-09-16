from pathlib import Path
import json,re
r=Path(__file__).resolve().parents[1]
supplement=r/"licenses"
lock=json.loads((r/'package-lock.json').read_text());parts=['# Third-party notices\n\nThe pinned Webflow operation schema in src/catalog.json is derived from Webflow MCP tool metadata. Webflow retains any applicable rights in that metadata.\n\nThird-party components retain their own licenses, including commercial-use permissions. The router license does not replace them. This inventory covers installed runtime and build dependencies; some platform-specific optional packages are absent. Rebuild notices when dependencies or target platforms change. Electron and Chromium include additional notices with the packaged runtime. Preserve those when distributing binaries.\n\nLocally copied shadcn/ui components are derived from shadcn/ui under MIT; see licenses/shadcn-ui.txt. Vendor trademarks are not licensed by these software licenses.\n']
fallback={'@electron-internal/extract-zip':'electron-extract-zip','@rolldown/binding-darwin-arm64':'rolldown','err-code':'err-code','react-remove-scroll-bar':'react-remove-scroll-bar'}
missing=[]
for rel,entry in sorted(lock['packages'].items()):
 root=r/rel
 if not rel or not root.exists():continue
 package=json.loads((root/'package.json').read_text());name=package['name'];version=package['version']
 files=[p for p in root.iterdir() if p.is_file() and re.match(r'^(licen[sc]e|copying|notice)(\.|$|-)',p.name,re.I)]
 if not files and name in fallback:
  f=supplement/(fallback[name]+'.txt')
  if f.exists():files=[f]
 parts.append('\n## '+name+' '+version+'\n\nLicense: '+str(entry.get('license','See package'))+'. '+('Build dependency.' if entry.get('dev') else 'Runtime dependency.')+'\n')
 if not files:missing.append(name);parts.append('\nLicense text requires review before redistribution.\n')
 for f in files:parts.append('\n### '+f.name+'\n\n```text\n'+f.read_text(errors='replace').rstrip()+'\n```\n')
if (supplement/'shadcn-ui.txt').exists():parts.append('\n## shadcn/ui — copied and adapted UI components\n\n```text\n'+(supplement/'shadcn-ui.txt').read_text()+'\n```\n')
(r/'THIRD_PARTY_NOTICES.md').write_text(''.join(parts))
print('Unresolved root license texts:',missing)
# Preserve the generator, without network retrieval, for reproducible local inventories.

if missing: raise SystemExit(1)
