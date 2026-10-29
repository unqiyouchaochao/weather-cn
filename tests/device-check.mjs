/* 真机版的本轮验收（v114 这一轮：背景模块取消、底与透出值并入主题）。
 *   node tests/device-check.mjs [serial]        不给 serial 就用 adb devices 里唯一那台
 *
 * 与浏览器那条的区别只有一件事：这里跑的是**装进壳里的那一版字节**（原生壳没有 SW，
 * `import('/js/…')` 取的就是 APK 里的文件），所以它回答的是「这台机上装的到底对不对」，
 * 而不是「仓库里的代码对不对」。
 *
 * 五项：① 背景那一栏的控件与 `#bgLayer` 整节点查不到（验收 1）+ 老配置那两样真的被迁移清了；
 *       ② 每一套的下发对上 themes.js、`glass.a` 是每套一个独立值（验收 2；2026-10-06 起清单只有两套，
 *          原来同一次循环里还量装饰暗度 --lace，那一套装饰跟着花嫁主题一起删了）；
 *       ③ 切主题那一帧六样同一帧换完，并带「探针真的换过」那道闸（验收 3/4）；
 *       ④ 毛玻璃层数（验收 6）：判的是**排名浮层内一条玻璃都不画**（那 362 层卡死就是这一档），
 *          外加整页在屏/原始两个观察值。注意：**原始总数是个随时辰变的量**（逐小时格子的个数就是「现在几点」，
 *          今晚 23 点就是 23 层），所以别拿它去比另一天另一台记下的那个 73 —— 那次是红米、另一次时辰。
 *          华为这一台本次读数：在屏 44 / 原始 74（v114，2026-10-05 23:27），开浮层时原始 74、浮层内 0；
 *       ⑦ 每一套 ☀/ 往返闭合（验收 7）；末尾把主题与天气态**复原**（这是用户每天在用的那台机）。
 *
 * 前置条件按踩过的方式写死：屏幕必须已解锁、应用必须真在前台 —— 锁屏时 JS 照跑、
 * computed style 半新半旧、rAF 那一帧可能根本不落，量到的每一份数都不可信（脚本会自己查并拒绝）。 */
const A = process.env.ADB || 'adb';
const PKG = 'com.weatherstudio.app';
const { execFileSync } = await import('node:child_process');
let SER = process.argv[2];
const sh = (...args) => execFileSync(A, args[0] === '-s' ? args : ['-s', SER, ...args], { encoding: 'utf8' });
if (!SER) {
  const 台 = sh('devices').split('\n').filter(l => /\tdevice$/.test(l)).map(l => l.split('\t')[0]);
  if (台.length !== 1) throw new Error('给我 serial：' + 台.join(', '));
  SER = 台[0];
}
const 说 = (...a) => console.log('[device-check ' + SER + ']', ...a);

/* ---------- 通道：把 WebView 的调试套接字转到本地 9222 ---------- */
sh('shell', 'input', 'keyevent', '224');                       // 先唤醒（息屏后第一下 tap 只是亮屏）
await new Promise(r => setTimeout(r, 1500));
const 窗口 = sh('shell', 'dumpsys', 'window');
if (/mIsShowing=true/.test(窗口)) {
  throw new Error('锁屏中：请真人解锁并把通知栏收下来（adb 推不开锁），否则每一份读数都不可信');
}
const 锁 = (/deviceLocked=(\d)/.exec(sh('shell', 'dumpsys', 'trust')) || [])[1];
if (锁 === '1') throw new Error('dumpsys trust 说 deviceLocked=1：还是锁着的');
if (!new RegExp(PKG).test(窗口 + sh('shell', 'dumpsys', 'activity', 'activities'))) {
  throw new Error('应用不在前台：mCurrentFocus=' + (/mCurrentFocus ([^\r\n]+)/.exec(窗口) || ['?', '读不到'])[1]);
}
const 找pid = () => { const m = /webview_devtools_remote_(\d+)/.exec(sh('shell', 'cat', '/proc/net/unix')); return m && m[1]; };
const pid = 找pid();
if (!pid) throw new Error('没有 webview_devtools_remote 套接字：WebView 还没起来（先把应用点开）');
sh('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid);
说('套接字已转发（pid=' + pid + '），开始量');


const 问 = (expr, 备注) => {
  try {
    return JSON.parse(execFileSync(process.execPath, ['tests/cdp-eval.mjs', expr], { encoding: 'utf8', cwd: process.cwd() }));
  } catch (e) {
    throw new Error('CDP 这一问没答（' + (备注 || '') + '）：' + String(e.stdout || e.message).slice(0, 200));
  }
};

/* ---------- 五条一起问，一次 CDP 往返 ---------- */
const 结果 = await 问(`
  const ui = await import('/js/ui.js');
  const TM = await import('/js/lib/themes.js');
  const glass = await import('/js/lib/glass.js');
  const out = {};
  /* ① 背景那一栏的控件与 #bgLayer：判「整节点不在」，不是「看不见」 */
  const ids = ['bgLayer','bgMode','bgGrid','bgPhotoRow','bgPhoto','bgClear','bgInfo','bgChipRow','bgChip','bgChipVal'];
  out.控件 = ids.filter(id => document.getElementById(id));
  out.老键 = { cfg有bg: ('bg' in (JSON.parse(localStorage.getItem('weather-studio-config') || '{}'))),
               照片键: localStorage.getItem('weather-bg-photo') !== null };

  /* ② 两套各自的下发：body 上读到的三个量 == themes.js 那一格里写的三个数；a 要两个独立值
   * （原来这里还量装饰暗度 --lace，2026-10-06 花嫁那一套删了，四件装饰与那一格一起没了，
   *  壳里就没有第二个lace真值可对了。） */
  const 起始 = document.body.dataset.theme, 起始态 = document.body.dataset.weather;
  const 不符 = [], 各个a = [];
  for (const t of TM.THEMES) {
    ui.applyTheme(t.id);
    const 应 = [t.glass.a + '%', t.glass.mix + '%', t.glass.blur + 'px'];
    const 实 = ['--glass-a','--glass-mix','--glass-blur'].map(n => getComputedStyle(document.body).getPropertyValue(n).trim());
    if (应.join('|') !== 实.join('|')) 不符.push(t.id + ' 应 ' + 应.join('|') + ' 实 ' + 实.join('|'));
    各个a.push(t.glass.a);
    const 渐变 = ui && document.body.style.getPropertyValue('--w-clear').trim();
    if (渐变 !== t.w.clear) 不符.push(t.id + ' 渐变没下发');
  }
  out.下发 = { 不符, 独立a: new Set(各个a).size, 套数: TM.THEMES.length };

  /* ③ 切主题那一帧：掐掉 transition，换完立刻读两帧，看有没有「主题新、底旧」 */
  const kill = document.createElement('style');
  kill.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(kill);
  /* 起点必须在这里重读一遍，不能沿用 ② 那个 起始：② 遍历完整张清单，跑完人是**停在最后一套**上的。
   * 清单还有 11 套时「下一套」和「② 的终点」从来不是同一个值，所以这个错看不出来；
   * 2026-10-06 收敛到两套（mint、dark）之后，用户存的就是 mint ⇒ 起始=mint、下一套=dark、② 的终点也是 dark，
   * 于是 ③ 第一轮的 applyTheme 是个**空操作**：底和渐变都没变（换过=false），而那一帧读到的六样又全对
   * （半新半旧=空）—— 现场长得像「切主题慢了一帧」，其实是探针自己没按下开关。华为连红四趟都这么报。 */
  const 起点 = document.body.dataset.theme;
  const 下一套 = TM.THEMES.find(t => t.id !== 起点).id;
  const 采 = () => ({
    主题: document.body.dataset.theme,
    渐变: document.body.style.getPropertyValue('--w-clear').trim(),
    透出: document.body.style.getPropertyValue('--glass-a').trim(),
    底: getComputedStyle(document.body).backgroundImage,
    卡面: getComputedStyle(document.querySelector('.day')).backgroundColor,
    状态栏: document.querySelector('meta[name=theme-color]').getAttribute('content') });
  const 半新半旧 = [], 换过 = [];
  for (let 轮 = 0; 轮 < 2; 轮++) {
    const 前 = 采();
    ui.applyTheme(下一套); ui.applyBg('sun');
    for (const 帧 of [0, 1]) {
      await new Promise(r => requestAnimationFrame(r));
      const s = 采();
      if (s.主题 !== 下一套) continue;
      const 旧 = [];
      if (s.渐变 !== TM.themeById(下一套).w.clear) 旧.push('底纹');
      if (s.透出 !== TM.themeById(下一套).glass.a + '%') 旧.push('透出度');
      if (s.状态栏 !== TM.themeById(下一套).meta) 旧.push('状态栏');
      if (!/linear-gradient/.test(s.底)) 旧.push('画不出底');
      if (s.卡面 === 'rgba(0, 0, 0, 0)') 旧.push('卡面没色');
      if (旧.length) 半新半旧.push('第' + (帧 + 1) + '帧:' + 旧.join('/'));
    }
    换过.push(前.底 !== 采().底 || 前.渐变 !== 采().渐变);
    ui.applyTheme(起点);
    await new Promise(r => requestAnimationFrame(r));
  }
  kill.remove();
  out.同帧 = { 半新半旧, 真的换过: 换过.every(Boolean) };

  /* ④ 毛玻璃层数。两条数，别混成一条：**「浮层内」才是那次卡死（362 层）的那道闸**，
   * 「整页总数」是个随时辰变的量 —— .hr.past 的个数就是「现在已经几点」（今晚 23 点 ⇒ 23 格），
   * 骨架屏那批节点在渲染完之前也在 DOM 里。所以拿它去比另一天另一台记下的 73 没有意义，
   * 这里改成：只数**真的在屏上占地方**的那些（有 rect、祖先没被 hidden 收掉），原始总数作为观察值一起打。 */
  const 玻璃 = n => { let c = 0; const 名 = {};
    for (const e of (n || document).querySelectorAll('*')) {
      const s = getComputedStyle(e);
      if (s.backdropFilter && s.backdropFilter !== 'none') { c++;
        /* 键只取第一个类名。这里踩过一次：这一段是外面那个模板字符串的**内容**，
         * 模板里想拿到正则的空符必须再转义一层，少一层就变成「按字母 s 切」——
         * 结果键全被打碎（"hr past" 变成 "hr pa"），**总数还是对的、分类却是垃圾**。
         * 现在改用字面空格切，另外下面加一道「分类之和 == 总数」的自校兜住这一类坏键。 */
        const k = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
          ('.' + (String(e.className || '').trim().split(' ')[0] || ''));
        名[k] = (名[k] || 0) + 1; }
    }
    const 和 = Object.values(名).reduce((a, b) => a + b, 0);
    return { c, 名, 分类和: 和, 对不上: 和 !== c }; };
  const 在屏 = e => { const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let p = e; p && p.nodeType === 1; p = p.parentElement) if (p.hidden) return false;
    return true; };
  const 在屏玻璃 = () => { let c = 0; for (const e of document.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      if (s.backdropFilter && s.backdropFilter !== 'none' && 在屏(e)) c++; } return c; };
  const 全 = 玻璃(document);
  out.层数 = { 整页原始: 全.c, 整页在屏: 在屏玻璃(), 小时格: 全.名['div.hr'] || 0, 分类对不上: 全.对不上, 分类: 全.名 };

  /* ⑦ ☀/ 往返：两套各自连点两下要回到原来那套，且第一下真的跨了明暗边 */
  const 往返 = [];
  for (const t of TM.THEMES) {
    let cfg = { theme: t.id, darkTheme: t.base === 'dark' ? t.id : TM.defaultOf('dark'),
                lightTheme: t.base === 'light' ? t.id : TM.defaultOf('light') };
    const 一步 = TM.toggleTheme(cfg), 两步 = TM.toggleTheme(一步);
    if (两步.theme !== t.id) 往返.push(t.id + '→' + 一步.theme + '→' + 两步.theme);
    if (TM.themeById(一步.theme).base === TM.themeById(t.id).base) 往返.push(t.id + ' 第一下没换边');
  }
  out.往返 = 往返;

  /* 复原现场：这套 localStorage 与界面是用户每天在用的 */
  ui.applyTheme(起始);
  document.body.dataset.weather = 起始态 || '';
  ui.applyBg();
  out.读数 = { 主题: document.body.dataset.theme, 透出: document.body.style.getPropertyValue('--glass-a').trim() };
  return out;
`, '五条主问');

/* ④ 的另一半：开排名浮层再数一次（362 层那次的教训就在这一档） */
const 浮层 = await 问(`
  const rank = await import('/js/ui/rank.js');
  rank.open('北京');
  await new Promise(r => setTimeout(r, 2600));
  const 层 = () => { let n = 0; for (const e of document.querySelectorAll('*')) {
      const s = getComputedStyle(e); if (s.backdropFilter && s.backdropFilter !== 'none') n++; } return n; };
  const 页 = 层();
  const 在浮层里 = () => { let n = 0; for (const e of document.querySelectorAll('#rankView *')) {
      const s = getComputedStyle(e); if (s.backdropFilter && s.backdropFilter !== 'none') n++; } return n; };
  const r = { 整页: 页, 浮层内: 在浮层里(), 行: document.querySelectorAll('#rankView li').length,
              开着: !document.getElementById('rankView').hidden };
  rank.close();
  await new Promise(r2 => setTimeout(r2, 700));
  r.关掉之后还开着 = !document.getElementById('rankView').hidden;
  return r;
`, '排名浮层');

const 过 = [];
const 判 = (名, 成立, 实测) => { 过.push({ 名, ok: !!成立, 实测 }); };
判('① 背景那十个控件整节点不在 DOM', 结果.控件.length === 0, 结果.控件.length ? '还在：#' + 结果.控件.join('#') : '10/10 查不到');
判('① 老配置里的 bg 与照片键已清', !结果.老键.cfg有bg && !结果.老键.照片键, JSON.stringify(结果.老键));
判('② 两套的下发对上 themes.js', 结果.下发.不符.length === 0, 结果.下发.不符.join(' ｜ ') || 结果.下发.套数 + '/' + 结果.下发.套数);
判('② 透出值是每套一个独立数', 结果.下发.独立a === 结果.下发.套数, 结果.下发.独立a + '/' + 结果.下发.套数);
判('③ 切主题那一帧六样一起换完', 结果.同帧.半新半旧.length === 0 && 结果.同帧.真的换过,
  结果.同帧.半新半旧.join(' ｜ ') || (结果.同帧.真的换过 ? '2 轮 × 2 帧同一帧换完（且真的换过）'
    : '有一轮 applyTheme 前后底纹一模一样 —— 探针起点就是目标那一套，开关根本没按下（不是切得慢）'));
判('④ 排名浮层内一条玻璃都不画（362 层那道闸）', 浮层.浮层内 === 0,
  '浮层内 ' + 浮层.浮层内 + ' 层（榜有 ' + 浮层.行 + ' 行，全在浮层里）');
判('④ 整页在屏玻璃还在量级内（基线：华为 2026-10-05 23:27 在屏 44 层 / 原始 74 层）',
  结果.层数.整页在屏 <= 60 && 浮层.整页 <= 结果.层数.整页原始 + 60,
  '天气页在屏 ' + 结果.层数.整页在屏 + ' 层（里面 ' + 结果.层数.小时格 + ' 个是逐小时格子，它的个数=现在已经几点，' +
  '所以这个数天生会随时辰动）、原始 ' + 结果.层数.整页原始 + ' 层；开浮层时原始 ' + 浮层.整页 + ' 层');
判('④ 浮层关掉之后真关了', 浮层.关掉之后还开着 === false, String(浮层.关掉之后还开着));
判('④ 读数自己的分类对得上（分类之和 == 总数；键被切坏时总数照样是对的，只有这一条会露）',
  结果.层数.分类对不上 === false && 结果.层数.小时格 > 0,
  '分类和=' + (结果.层数.分类对不上 ? '不等于' : '等于') + ' 总数，小时格 ' + 结果.层数.小时格 + ' 个');
判('⑦ 每一套 ☀/ 往返闭合', 结果.往返.length === 0, 结果.往返.join(' ｜ ') || 结果.下发.套数 + '/' + 结果.下发.套数 + ' 回到原套且第一下跨边');
判('现场已复原', !!结果.读数.主题, JSON.stringify(结果.读数));

console.log(JSON.stringify({ 设备: SER, 结果, 浮层, 判据: 过 }, null, 2));
const 红 = 过.filter(x => !x.ok);
console.log((红.length ? '✗ ' + 红.length + ' 条不过：' + 红.map(x => x.名).join('；') : '✓ 真机五条全过') +
  '（读数：天气页在屏 ' + 结果.层数.整页在屏 + ' / 原始 ' + 结果.层数.整页原始 + ' 层；开浮层原始 ' + 浮层.整页 + ' 层，其中浮层内 ' + 浮层.浮层内 + ' 层）');
if (红.length) process.exitCode = 1;
