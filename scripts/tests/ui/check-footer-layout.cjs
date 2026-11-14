/* eslint-disable @typescript-eslint/no-require-imports -- Electron layout regression test. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  ts = require('typescript')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-footer-layout-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 800,
    webPreferences: { sandbox: true, backgroundThrottling: false }
  })
  try {
    const entry = fs.readFileSync('out/theme-validation/renderer/index.html', 'utf8')
    const css = [...entry.matchAll(/href="\.\/(assets\/[^"]+\.css)"/g)]
      .map((match) => fs.readFileSync(path.join('out/theme-validation/renderer', match[1]), 'utf8'))
      .join('\n')
    const utility = ts.transpileModule(
      fs.readFileSync('src/renderer/src/utils/footerLayout.ts', 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    ).outputText
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    await window.webContents.executeJavaScript(`(()=>{
      const exports={};(function(exports){${utility}})(exports);window.footerUtils=exports;
      const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
      document.documentElement.classList.add('dark','reduce-motion');
      const fixture=document.createElement('style');fixture.textContent='body{padding:16px}.fixture{display:grid;align-items:center;min-height:72px;padding:10px 16px;border:1px solid;box-sizing:border-box;margin:40px auto}.ep-footer-info{display:flex;min-width:0;gap:12px}.cover{width:48px;height:48px;flex-shrink:0}.title{min-width:0;overflow:hidden;white-space:nowrap}.ep-footer-transport{display:flex;align-items:center;justify-content:center;gap:4px}.buttons{display:flex;gap:6px}.ep-footer-top-time{font-size:11px}.buttons button{width:32px;height:40px;flex-shrink:0}.ep-footer-progress{align-items:center;min-width:0}.ep-footer-progress input{min-width:0;width:100%}.ep-footer-actions{display:flex;justify-content:flex-end;gap:8px;min-width:0}.ep-footer-actions>button,.volume,.more>button{width:32px;height:32px}.more{position:relative}.fixture-menu{position:absolute;right:0;bottom:100%;width:220px;opacity:0;pointer-events:none}.ep-footer-toggle{width:32px;height:32px}';document.head.append(fixture);
      const actions='<div class="volume ep-footer-action-volume">V</div><button class="ep-footer-action-mode">M</button><button class="ep-footer-action-secondary">L</button><button class="ep-footer-action-secondary">D</button><button class="ep-footer-action-queue">Q</button><button class="ep-footer-action-secondary">Y</button><div class="more"><button>…</button><div class="fixture-menu"><button class="ep-footer-menu-secondary menu-item">Like</button><button class="ep-footer-menu-mode menu-item">Mode</button><button class="ep-footer-menu-queue menu-item">Queue</button><div class="ep-footer-menu-volume">Volume</div></div></div>';
      document.body.innerHTML='<section id="current" class="fixture ep-footer app-footer--expanded"><div class="ep-footer-info"><div class="cover">♫</div><div class="title">A very long song title that truncates</div></div><div class="ep-footer-playback"><div class="ep-footer-transport"><div class="buttons ep-footer-transport-buttons"><button>◀</button><button>Ⅱ</button><button>▶</button><div class="ep-footer-top-time"><span>01:20</span><span class="ep-footer-total-time"> / 01:03:40</span></div></div></div><div class="ep-footer-progress"><span>01:20</span><input type="range" class="ep-range" /><span>01:03:40</span></div></div><div class="ep-footer-actions">'+actions+'</div><button class="ep-footer-toggle">›</button></section>';
      const current=document.querySelector('#current');
      const check=(ok,message)=>{if(!ok)throw new Error(message)};
      window.updateActions=()=>exports.updateFooterSideWidths(current);
      window.setFooter=(value)=>{current.removeAttribute('style');for(const [key,val] of Object.entries(exports.footerLayoutStyle(value)))current.style.setProperty(key,val);window.updateActions()};
      window.checkFooter=()=>{
        const root=current.getBoundingClientRect(),center=root.left+root.width/2;
        for(const selector of ['.buttons','.ep-footer-progress input']){
          const box=current.querySelector(selector).getBoundingClientRect();check(Math.abs(box.left+box.width/2-center)<1,'center alignment '+selector);
        }
        for(const category of ['secondary','mode','queue','volume']){
          const source=current.querySelector('.ep-footer-action-'+category), menu=current.querySelector('.ep-footer-menu-'+category);
          check((getComputedStyle(source).display==='none')===(getComputedStyle(menu).display!=='none'),'hidden action remains available: '+category);
        }
        for(const child of current.querySelectorAll('.ep-footer-actions>button,.volume,.more>button,.buttons button,.ep-footer-toggle')){
          const box=child.getBoundingClientRect();if(box.width&&box.height)check(box.left>=root.left-1&&box.right<=root.right+1,'control overflow');
        }
        const popup=current.querySelector('.fixture-menu'),previous=popup.style.cssText;popup.style.cssText='opacity:1;pointer-events:auto';
        const mode=popup.querySelector('.ep-footer-menu-mode');if(getComputedStyle(mode).display!=='none'){let used=false;mode.onclick=()=>used=true;mode.click();check(used,'overflow command remains clickable')}popup.style.cssText=previous;
      };
      window.checkTop=()=>{
        const box=current.querySelector('.ep-footer-progress').getBoundingClientRect(),root=current.getBoundingClientRect();
        check(Math.abs(box.top+box.height/2-root.top)<=2,'progress is on the footer top edge');
        check(box.width>root.width*.85,'top progress spans footer');
        check(getComputedStyle(current.querySelector('.ep-footer-progress>span')).display==='none','top line hides inline time labels');
        const time=current.querySelector('.ep-footer-top-time'),row=current.querySelector('.buttons');
        check(getComputedStyle(time).display!=='none','top mode retains playback time');
        const timeBox=time.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
        check(timeBox.left>=rowBox.right+7&&Math.abs(timeBox.top+timeBox.height/2-rowBox.top-rowBox.height/2)<1,'time appears to the right of centered controls');
        const infoBox=current.querySelector('.ep-footer-info').getBoundingClientRect(),gap=parseFloat(getComputedStyle(current).columnGap);
        const contentGap=Math.max(12,gap),leftSpace=rowBox.left-infoBox.right;
        check(leftSpace>=contentGap-1,'song info keeps breathing room before the controls');
        if(infoBox.width>201){
          const rightSpace=current.querySelector('.ep-footer-actions').getBoundingClientRect().left-rowBox.right;
          check(Math.abs(leftSpace-rightSpace)<2,'roomy top mode balances the spacing on both sides of the controls');
        }
        const available=rowBox.left-infoBox.left-contentGap;
        check(infoBox.width>=Math.min(200,available)-1,'narrow windows prioritize space for song info');
        for(const action of current.querySelectorAll('.ep-footer-actions>button,.volume,.more>button')){const actionBox=action.getBoundingClientRect();if(actionBox.width)check(timeBox.right+3<=actionBox.left,'time does not overlap actions')}
      };
      window.checkFooter();
      for(const weight of [1,2.2,4])for(const gap of [8,20,32]){window.setFooter({enabled:true,maxWidth:900,progressWeight:weight,gap});window.checkFooter()}
      window.setFooter({enabled:true,maxWidth:1320,progressWeight:1});const short=current.querySelector('input').getBoundingClientRect().width;
      window.setFooter({enabled:true,maxWidth:1320,progressWeight:4});check(current.querySelector('input').getBoundingClientRect().width>short,'ratio adjusts width');window.checkFooter();
      window.setFooter({enabled:true,mode:'stacked'});window.checkFooter();window.checkTop();
      for(const weight of [1,2.2,4]){
        window.setFooter({enabled:true,mode:'stacked',progressWeight:weight});window.checkFooter();window.checkTop();
        const title=current.querySelector('.title');check(title.scrollWidth<=title.clientWidth,'song title fits when the left side has room');
        for(const action of current.querySelectorAll('.ep-footer-action-secondary,.ep-footer-action-volume,.ep-footer-action-mode,.ep-footer-action-queue'))check(getComputedStyle(action).display!=='none','roomy top mode restores all toolbar actions');
      }
      current.style.transform='scaleX(.986)';window.updateActions();
      const animatedWidth=current.querySelector('.ep-footer-actions').style.width;
      current.style.transform='none';window.updateActions();
      check(animatedWidth===current.querySelector('.ep-footer-actions').style.width,'expand animation preserves available width');
      const title=current.querySelector('.title'),originalTitle=title.textContent;title.textContent=originalTitle.repeat(8);window.updateActions();window.checkTop();
      check(title.scrollWidth>title.clientWidth,'long titles still truncate when space is exhausted');title.textContent=originalTitle;
      window.setFooter({enabled:true,mode:'centered'});check(!current.querySelector('.ep-footer-info').style.width,'inline progress restores normal song info width');window.checkFooter();
      window.setFooter({enabled:true,mode:'stacked',progressWeight:4});
      const time=current.querySelector('.ep-footer-top-time');time.style.fontSize='22px';window.updateActions();window.checkFooter();window.checkTop();
      time.style.fontSize='';window.updateActions();
      const theme=document.createElement('style');theme.textContent=':root{--ep-footer-max-width:1000px !important}';document.head.append(theme);
      window.setFooter({enabled:false});check(Math.abs(current.getBoundingClientRect().width-1000)<1,'disabled follows theme');
      window.setFooter({enabled:true,maxWidth:1400});check(current.getBoundingClientRect().width>1300,'user layout overrides inherited theme variables');theme.remove();
      window.setFooter({enabled:false});
    })()`)
    for (const viewport of [1100, 980, 800, 701, 700, 540, 440]) {
      window.setContentSize(viewport, 800)
      await new Promise((resolve) => setTimeout(resolve, 80))
      await window.webContents.executeJavaScript(
        'window.updateActions();window.checkFooter();if(window.innerWidth<=980)window.checkTop()'
      )
      if (viewport === 980) {
        await window.webContents.executeJavaScript(`
          for(const category of ['volume','mode'])if(getComputedStyle(document.querySelector('.ep-footer-action-'+category)).display==='none')throw new Error('roomy narrow window should expose '+category);
        `)
      }
    }
    window.setContentSize(1440, 800)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const rect = await window.webContents.executeJavaScript(`(()=>{
      window.setFooter({enabled:true,mode:'stacked'});window.checkTop();
      const input=document.querySelector('.ep-footer-progress input');input.style.setProperty('--ep-range-progress','0');input.style.setProperty('--ep-range-has-progress','0');
      const box=input.getBoundingClientRect();return {x:Math.floor(box.x),y:Math.floor(box.y),width:Math.floor(box.width),height:Math.ceil(box.height)};
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const empty = (await window.webContents.capturePage(rect)).toPNG()
    await window.webContents.executeJavaScript(
      "const input=document.querySelector('.ep-footer-progress input');input.style.setProperty('--ep-range-progress','0.25');input.style.setProperty('--ep-range-has-progress','1')"
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
    const partial = (await window.webContents.capturePage(rect)).toPNG()
    const sharp = require('sharp'),
      a = await sharp(empty).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      b = await sharp(partial).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const pixel = (image, ratio) => {
      const index =
        (Math.floor(image.info.height / 2) * image.info.width +
          Math.floor(image.info.width * ratio)) *
        4
      return image.data.subarray(index, index + 4).toString('hex')
    }
    if (pixel(a, 0.1) === pixel(b, 0.1)) throw new Error('played part should be painted')
    if (pixel(a, 0.85) !== pixel(b, 0.85))
      throw new Error('unplayed part should remain transparent')
    console.log(
      'Footer centering, balanced song info spacing, right-side time, transparent unplayed pixels, overflow menus and narrow windows passed'
    )
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window.destroy()
    app.exit(1)
  }
})
