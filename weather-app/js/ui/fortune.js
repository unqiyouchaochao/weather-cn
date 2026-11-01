/* 运势板块视图：八字排盘 + 星座运势。
 * 计算全在 lib/ganzhi.js 与 lib/horoscope.js，本模块只做「算 → 拼 HTML」，
 * 不发任何请求、不读任何远端文本（原因见 lib/ganzhi.js 顶部对免费星座接口的实测结论）。
 *
 * 与 main.js 的关系：main.js 只负责切 tab（body[data-tab]）；本板块的两个输入框由
 * init() 自己绑，生日只落 localStorage 不上网络。板块内部的事不往 main.js 里堆。 */
import { el } from '../lib/dom.js';
import { esc, cssVar, downloadBlob, weekday } from '../lib/util.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { fourPillars, dayOf, relation } from '../lib/ganzhi.js';
import { almanac } from '../lib/almanac.js';
import { signOf, dailyFortune, localISO } from '../lib/horoscope.js';

/* 时辰：value 是 0..11 的地支序号，-1 = 不确定。
 * REP 是每辰的代表小时，只用来跟节气交点比先后（子时用 00:30，即夜子不换日那一派）。 */
const SHICHEN = [['子', '23:00–00:59'], ['丑', '01:00–02:59'], ['寅', '03:00–04:59'], ['卯', '05:00–06:59'],
  ['辰', '07:00–08:59'], ['巳', '09:00–10:59'], ['午', '11:00–12:59'], ['未', '13:00–14:59'],
  ['申', '15:00–16:59'], ['酉', '17:00–18:59'], ['戌', '19:00–20:59'], ['亥', '21:00–22:59']];
const REP = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
/* 五行色只用于那一小条占比图，不参与主题换肤（五行配色本身是固定的文化约定） */
const ELEM_COLOR = { 木: '#2e8b57', 火: '#d1493b', 土: '#b08015', 金: '#7d8896', 水: '#2f6fa8' };
const ELEMS = ['木', '火', '土', '金', '水'];
/* 最近一次 render 的结果，导出直接复用它 */
let last = null;

export function init() {
  el.birthShichen.innerHTML = '<option value="-1">不确定（只看年月日）</option>' +
    SHICHEN.map((s, i) => '<option value="' + i + '">' + s[0] + '时 ' + s[1] + '</option>').join('');
  syncForm();
  el.birthDate.addEventListener('change', save);
  el.birthShichen.addEventListener('change', save);
  el.fzCopy.addEventListener('click', copyReport);
  el.fzPng.addEventListener('click', exportImage);
  bindHold(el.fzLock, () => setLocked(false));
  bindHold(el.fzReset, reset);
  setLocked(!!current());
}

/* 生辰是这一版盘唯一的输入：误触改一天，八字/五行/每日运势就全跟着变，而用户未必看得出为什么变了。
 * 所以设好之后锁住，要改必须长按两秒把进度条按满；「重置」也走同一道门槛，不然一键就绕过了锁。
 * 解锁后只给一个编辑窗口，到点自己锁回去 —— 免得解锁一次之后就永久开着，等于没锁。 */
const HOLD_MS = 2000;
const EDIT_WINDOW_MS = 60000;
let unlockTimer = null;

function bindHold(node, onDone) {
  let timer = null;
  const abort = () => { if (timer) { clearTimeout(timer); timer = null; } node.classList.remove('holding'); };
  node.addEventListener('pointerdown', e => {
    e.preventDefault();                    // 掐掉随后的 click：短按什么都不该发生
    node.classList.add('holding');
    timer = setTimeout(() => { abort(); onDone(); }, HOLD_MS);
  });
  // 不在 pointermove 上取消：手指按住时本来就会抖，那样两秒根本按不满
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => node.addEventListener(ev, abort));
}

function setLocked(locked) {
  if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
  el.birthDate.disabled = locked;
  el.birthShichen.disabled = locked;
  el.fzForm.classList.toggle('locked', locked);
  const has = !!current();
  el.fzLock.hidden = !has;                 // 还没设生辰时无所谓锁，不显示这个条
  el.fzLockText.textContent = locked ? '🔒 生辰已设定 · 长按 2 秒修改' : '已解锁 · 改完保存即重新锁定';
  if (!locked && has) unlockTimer = setTimeout(() => setLocked(true), EDIT_WINDOW_MS);
}

/* 一键重置：生辰与 localStorage 一起清掉，今日黄历随之回来（render 里按「有没有生辰」决定显隐）。
 * 只写 note、不走 flash()：flash 会在 2.6 秒后把文案换回上一次排盘的说明，而重置后已经没有上一次了。 */
function reset() {
  const cfg = loadConfig();
  cfg.birth = null;
  saveConfig(cfg);
  el.birthDate.value = '';
  el.birthShichen.value = '-1';
  render();
  el.fzNote.textContent = '已重置：生辰清空，回到今日黄历。';
  setLocked(false);   // 重置之后应当能直接填新的，不用再长按一次
}

function current() { return loadConfig().birth || null; }

function syncForm() {
  const b = current();
  el.birthDate.value = b && b.iso ? b.iso : '';
  el.birthShichen.value = b && b.s != null ? String(b.s) : '-1';
}

/* 表单 → 生辰。日期没填/填得不完整时返回 null（清空排盘，但不动已存的配置） */
function readBirth() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(el.birthDate.value || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { iso: el.birthDate.value, y, mo, d, s: +el.birthShichen.value };
}

function save() {
  const cfg = loadConfig();
  const b = readBirth();
  cfg.birth = b ? { iso: b.iso, y: b.y, mo: b.mo, d: b.d, s: b.s } : null;
  saveConfig(cfg);
  render();
  setLocked(!!cfg.birth);   // 存好一个完整生辰就立刻锁回去
}

const stars = n => '<span class="fz-stars">' + '★'.repeat(n) + '<i>' + '★'.repeat(Math.max(0, 5 - n)) + '</i></span>';

function luckHTML(f) {
  return '<div class="fz-luck"><span>幸运色 <b>' + esc(f.color) + '</b></span>' +
    '<span>幸运数 <b>' + f.number + '</b></span>' +
    '<span>有利方位 <b>' + esc(f.direction) + '</b></span></div>' +
    '<div class="fz-yi"><span><i class="tag ok">宜</i>' + esc(f.yi) + '</span>' +
    '<span><i class="tag err">忌</i>' + esc(f.ji) + '</span></div>' +
    '<p class="fz-tip">「' + esc(f.tip) + '」</p>';
}

function aspectsHTML(f) {
  return '<div class="fz-score"><b>' + esc(f.level) + '</b>' +
    stars(Math.round(f.aspects.reduce((s, a) => s + a.n, 0) / 4)) +
    '<span class="fz-sub">' + f.aspects.reduce((s, a) => s + a.n, 0) + '/20</span></div>' +
    '<div class="fz-aspects">' + f.aspects.map(a => '<span>' + a.label + ' ' + stars(a.n) + '</span>').join('') + '</div>';
}

/* 今日黄历。只在「还没填生辰」时占住顶部 —— 一开始人为输入排盘就整卡收起（清空日期即恢复），
 * 因为那时候用户要看到的是自己的盘，不是通用黄历。 */
function renderAlmanac(now) {
  const a = almanac(now);
  const j = a.jianchu;
  const dao = j.dao === '黄道' || j.dao === '吉日' ? 'ok' : j.dao === '凶日' ? 'err' : '';
  const term = a.term.days === 0
    ? '今日交' + a.term.name + ' ' + a.term.at.split(' ')[1]
    : '距' + a.term.name + ' ' + a.term.days + ' 天（' + a.term.at + '）';
  el.fzHl.innerHTML =
    '<h3>今日黄历<span class="fz-meta">' + esc(a.solar) + ' ' + weekday(now) +
    (a.lunar ? ' · 农历' + esc(a.lunar) : '') + '</span></h3>' +
    '<div class="hl-gz"><b>' + esc(a.gzDay) + '日</b>' +
    '<span>' + esc(a.gzYear) + '年 ' + esc(a.gzMonth) + '月 · ' + esc(a.elem) + '日主 · 属' + esc(a.zodiac) + '</span>' +
    '<span class="hl-dao ' + dao + '">值' + esc(j.name) + ' · ' + esc(j.dao) + '</span></div>' +
    '<p class="hl-note">' + esc(j.note) + '</p>' +
    '<div class="fz-yi"><span><i class="tag ok">宜</i>' + esc(j.yi) + '</span>' +
    '<span><i class="tag err">忌</i>' + esc(j.ji) + '</span></div>' +
    '<div class="hl-foot"><span>冲' + esc(a.clash.animal) + '（' + esc(a.clash.gz) + '）煞' + esc(a.sha) + '</span>' +
    '<span>' + esc(term) + '</span></div>' +
    '<p class="fz-sub small">彭祖百忌：' + esc(a.pengzi) + '</p>' +
    '<p class="fz-sub small">宜忌按「建除十二值」的通用条目取，不含逐日吉神凶煞，各版本老黄历所记略异；' +
    '农历由浏览器内置历法给出，干支与节气按本机推算（算法见 <code>js/lib/almanac.js</code>）。</p>';
}

/* 上一次画进屏的那一份是「哪一天 + 哪一套生辰」算出来的。
 * 进板块照旧要重算 —— 应用可能整夜开着，跨天之后干支与运势文案必须换成新的一天；
 * 但「重算」不等于「重画」：算完的键没变，屏上那三张卡的内容就不可能变，此时把
 * el.fzDay / el.fzHl / el.fzBazi / el.fzSign 全部 innerHTML 重来一遍是白干的一笔布局。
 * 键里放的是算出来的干支而不是日期字符串，所以跨节气那个月柱变更也换得动键（数学很便宜：
 * fourPillars 实测 0.083ms，贵的是 DOM 与布局）。 */
let 画着 = '';

export function render() {
  const now = new Date();
  const today = dayOf(now);
  const t = fourPillars(now.getFullYear(), now.getMonth() + 1, now.getDate(), 12);
  const b = readBirth();
  const iso = localISO(now);
  const 键 = [t.pillars[0].gz, t.pillars[1].gz, today.gz, today.elem, t.zodiac, iso,
    b ? b.y + '-' + b.mo + '-' + b.d + '-' + b.s : '无生辰'].join('/');
  if (键 === 画着) return;
  画着 = 键;

  el.fzDay.innerHTML = '<b>' + (now.getMonth() + 1) + '月' + now.getDate() + '日</b>今日 ' +
    t.pillars[0].gz + '年 ' + t.pillars[1].gz + '月 <b>' + today.gz + '日</b>' +
    '<span class="fz-sub">' + today.elem + ' · 属' + t.zodiac + '</span>';

  el.fzHl.innerHTML = '';
  el.fzHl.hidden = !!b;      // 一开始人为输入排盘就收起黄历（清空日期即恢复）：那时要看的是自己的盘
  if (!b) {
    renderAlmanac(now);
    el.fzNote.textContent = '填出生日期就能看今天的运势，只存在本机，不上传。';
    el.fzBazi.innerHTML = '<p class="fz-empty">尚未填写出生日期</p>';
    el.fzSign.innerHTML = '';
    last = null;
    return;
  }
  const known = b.s >= 0;
  const r = fourPillars(b.y, b.mo, b.d, known ? REP[b.s] : null);
  const rel = relation(r.dayMaster, today.elem);
  // 种子只用真实排出的柱：时辰未知时不让一个编出来的时柱参与，也就不会平白多一重吉凶
  const f = dailyFortune(r.pillars.map(p => p.gz).join(''), iso, known ? rel.score - 3 : 0);

  el.fzNote.textContent = known
    ? '按钟表时间排盘，不做真太阳时修正；23 点后出生归夜子时、日柱不换次日。'
    : '时辰未知 → 只排三柱，年/月柱按正午与节气交点比对。';
  const note = el.fzNote.textContent;

  el.fzBazi.innerHTML =
    '<h3>八字 <span class="fz-meta">属' + r.zodiac + ' · 日主' + r.pillars[2].gz[0] + r.dayMaster + '</span></h3>' +
    '<div class="fz-pillars">' + pillarCells(r) + '</div>' +
    '<div class="fz-wx">' + Object.keys(r.counts).map(k =>
      '<span class="wx" style="--c:' + ELEM_COLOR[k] + '"><i style="width:' +
      Math.round(r.counts[k] / r.counted * 100) + '%"></i><em>' + k + r.counts[k] + '</em></span>').join('') + '</div>' +
    (known ? '<p class="fz-rel">今日' + today.gz + '日（' + today.elem + '）于日主' + r.dayMaster +
      '为 <b>' + rel.ten + ' · ' + rel.rel + '</b> —— ' + esc(rel.note) + '</p>' : '') +
    aspectsHTML(f) + luckHTML(f) +
    '<p class="fz-sub small">下一个节气：' + esc(r.nextJie.name) + ' ' + esc(r.nextJie.at) +
    '（出生贴近交节时月柱归属两说，可依此自行核对）</p>';

  const sg = signOf(b.mo, b.d);
  const fs = dailyFortune(sg.name, iso, 0);
  el.fzSign.innerHTML =
    '<h3><span class="fz-glyph">' + sg.glyph + '</span>' + sg.name +
    '<span class="fz-meta">' + sg.el + '象 · ' + b.mo + '月' + b.d + '日</span></h3>' +
    aspectsHTML(fs) + luckHTML(fs);

  // 导出用的同一份结果：不让报告再算一遍，避免界面与文件出现两种数字
  last = { b, known, r, rel, f, sg, fs, today, note, gzYear: t.pillars[0].gz, gzMonth: t.pillars[1].gz, iso };
}

/* 四柱格：时辰未知时补一个占位格，保持四列版式不散 */
function pillarCells(r) {
  let html = r.pillars.map((p, i) =>
    '<div class="fz-pill' + (i === 2 ? ' me' : '') + '">' +
    '<span class="p-l">' + p.label + '</span>' +
    '<span class="p-gz">' + p.gz[0] + '<br>' + p.gz[1] + '</span>' +
    '<span class="p-e">' + p.elem + ' / ' + p.nayin + '</span></div>').join('');
  if (r.pillars.length < 4) {
    html += '<div class="fz-pill dim"><span class="p-l">时柱</span>' +
      '<span class="p-gz">–<br>–</span><span class="p-e">未知</span></div>';
  }
  return html;
}

/* ---------- 报告导出（纯文本 + 图片卡片） ---------- */
/* 复用上一次 render 的结果，不重算：算两遍就有出现两种数字的机会。
 * 图片走 canvas 而不是「把 DOM 截图」：后者要么引 html2canvas 那种库，要么依赖
 * foreignObject（在 WebView 里字体/裁剪坑更多），而这份版式是已知的，直接画最稳。 */
const starText = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

let flashTimer = null;
function flash(msg) {
  el.fzNote.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (last) el.fzNote.textContent = last.note; }, 2600);
}

function born() {
  const { b, known } = last;
  return b.iso + (known ? ' ' + SHICHEN[b.s][0] + '时' : ' 时辰未知');
}

function reportText() {
  if (!last) return '';
  const { b, known, r, rel, f, sg, fs, today, gzYear, gzMonth, iso } = last;
  const d = new Date(iso + 'T12:00:00');
  const block = x => [
    '运势：' + x.level + '　' + x.aspects.map(a => a.label + starText(a.n)).join('　'),
    '幸运色 ' + x.color + ' · 幸运数 ' + x.number + ' · 有利方位 ' + x.direction,
    '宜 ' + x.yi + '　忌 ' + x.ji,
    '「' + x.tip + '」'
  ];
  const L = [];
  L.push('今日运势 · ' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日');
  L.push('' + gzYear + '年 ' + gzMonth + '月 ' + today.gz + '日');
  L.push('命主：' + born() + ' · 属' + r.zodiac + ' · 日主' + r.pillars[2].gz[0] + r.dayMaster);
  L.push('');
  L.push('【八字】' + r.pillars.map(p => p.label.charAt(0) + ' ' + p.gz).join('　') + (known ? '' : '　时柱未知'));
  L.push('五行：' + ELEMS.map(k => k + r.counts[k]).join(' '));
  if (known) L.push('今日' + today.gz + '日（' + today.elem + '）于日主' + r.dayMaster + '：' + rel.ten + ' · ' + rel.rel + ' —— ' + rel.note);
  L.push.apply(L, block(f));
  L.push('');
  L.push('【星座】' + sg.glyph + ' ' + sg.name + '（' + sg.el + '象 · ' + b.mo + '月' + b.d + '日）');
  L.push.apply(L, block(fs));
  L.push('');
  L.push('— 民俗/娱乐参考。四柱由本机干支历推算（立春定年、节气定月、六十循环定日），');
  L.push('  运势文案按「命主 + 当日日期」确定性生成，不是预测，不构成决策依据。');
  L.push('  天气助手 · Weather Studio');
  return L.join('\n');
}

async function copyReport() {
  if (!last) { flash('先填出生日期'); return; }
  const txt = reportText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(txt);
      flash('运势报告已复制到剪贴板');
      return;
    }
  } catch (e) { /* 非安全上下文或未授权 → 落到 prompt，不静默失败 */ }
  window.prompt('复制以下运势报告：', txt);
}

/* 手机上「下载」经常没有落点（WebView 不一定接了下载管理），能分享就先分享 */
async function saveBlob(blob, name, title) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title });
      return '已通过系统分享导出';
    }
  } catch (e) { return '已取消分享'; }
  downloadBlob(blob, name);
  return '已保存 ' + name;
}

function exportImage() {
  if (!last) { flash('先填出生日期'); return; }
  const { b, known, r, rel, f, sg, fs, today, gzYear, gzMonth, iso } = last;
  const W = 640, P = 40, dpr = window.devicePixelRatio || 1;
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = 1400 * dpr;
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const ink = cssVar('--ink', '#1f2a37'), muted = cssVar('--muted', '#6b7785');
  const card = cssVar('--card', '#ffffff'), bg = cssVar('--bg', '#eef3f8');
  const line = cssVar('--line', '#e2e8f0'), accent = cssVar('--accent', '#1d4ed8');
  const sun = cssVar('--sun', '#f5a623'), pop = cssVar('--pop', '#2c6fa8'), tint = cssVar('--tint', 'rgba(0,0,0,.06)');
  c.fillStyle = bg; c.fillRect(0, 0, W, 1400);
  c.fillStyle = card; roundRect(c, 16, 16, W - 32, 1368, 22); c.fill();
  c.strokeStyle = line; c.lineWidth = 1; c.stroke();

  const put = (t, x, y, size, color, weight, align) => {
    c.fillStyle = color; c.font = (weight || 400) + ' ' + size + 'px sans-serif';
    c.textAlign = align || 'left'; c.fillText(t, x, y); c.textAlign = 'left';
  };
  const rule = y => { c.strokeStyle = line; c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke(); };
  let y = P + 8;
  const d = new Date(iso + 'T12:00:00');
  put('今日运势', P, y + 18, 26, ink, 600);
  put((d.getMonth() + 1) + '月' + d.getDate() + '日', W - P, y + 18, 20, muted, 400, 'right');
  y += 40;
  put(gzYear + '年 ' + gzMonth + '月 ' + today.gz + '日 · 属' + r.zodiac, P, y + 14, 15, accent, 600);
  y += 24;
  put('命主 ' + born() + ' · 日主' + r.pillars[2].gz[0] + r.dayMaster, P, y + 14, 13, muted);
  y += 30; rule(y); y += 24;

  // 四柱：干在上支在下，日柱那格描边（它是全局的参照点）
  const cw = (W - P * 2) / 4;
  const cells = r.pillars.map(p => ({ l: p.label, g: [p.gz.charAt(0), p.gz.charAt(1)], e: p.elem + ' · ' + p.nayin }));
  if (!known) cells.push({ l: '时柱', g: ['–', '–'], e: '未知' });
  cells.forEach((p, i) => {
    const x = P + i * cw;
    if (i === 2) { c.fillStyle = tint; roundRect(c, x + 3, y - 4, cw - 6, 92, 12); c.fill(); }
    put(p.l, x + cw / 2, y + 12, 12, muted, 400, 'center');
    put(p.g[0], x + cw / 2, y + 44, 26, ink, 600, 'center');
    put(p.g[1], x + cw / 2, y + 70, 26, ink, 600, 'center');
    put(p.e, x + cw / 2, y + 88, 11, muted, 400, 'center');
  });
  y += 104;

  // 五行：一根堆叠条，宽度即占比
  put('五行', P, y + 12, 13, muted, 600);
  const bw = W - P * 2 - 60;
  let bx = P + 44;
  ELEMS.forEach(k => {
    const n = r.counts[k], w = n / r.counted * bw;
    if (n) { c.fillStyle = ELEM_COLOR[k]; c.globalAlpha = .55; c.fillRect(bx, y + 2, w, 14); c.globalAlpha = 1; }
    bx += w;
  });
  put(ELEMS.map(k => k + r.counts[k]).join('  '), W - P, y + 13, 12, muted, 400, 'right');
  y += 34;
  if (known) {
    put('今日' + today.gz + '日于日主' + r.dayMaster + '：' + rel.ten + ' · ' + rel.rel, P, y + 12, 15, ink, 600);
    y += 22;
    put(rel.note, P, y + 12, 13, muted);
    y += 26;
  }

  const luckBlock = (x, head) => {
    put(head, P, y + 16, 18, ink, 600);
    put(x.level, W - P, y + 16, 17, accent, 700, 'right');
    y += 30;
    const half = Math.ceil(x.aspects.length / 2);
    for (let i = 0; i < 2; i++) {
      x.aspects.slice(i * half, i * half + half).forEach((a, j) => {
        const col = i * half + j;
        const ax = P + (col % 2) * 280;
        put(a.label, ax, y + 12, 14, muted);
        put(starText(a.n), ax + 46, y + 13, 15, sun, 600);
      });
      y += 26;
    }
    put('幸运色 ' + x.color + ' · 幸运数 ' + x.number + ' · 有利方位 ' + x.direction, P, y + 12, 14, ink);
    y += 24;
    put('宜 ' + x.yi, P, y + 12, 14, ink);
    y += 22;
    put('忌 ' + x.ji, P, y + 12, 14, muted);
    y += 24;
    put('「' + x.tip + '」', P, y + 10, 14, pop);
    y += 26;
  };
  rule(y); y += 20;
  luckBlock(f, '八字 · 属' + r.zodiac + ' · 日主' + r.dayMaster);
  rule(y); y += 20;
  luckBlock(fs, sg.glyph + ' ' + sg.name + '（' + sg.el + '象 · ' + b.mo + '月' + b.d + '日）');
  rule(y); y += 20;
  put('民俗/娱乐参考：四柱由本机干支历推算，运势文案按「命主 + 当日日期」确定性生成，不是预测。', P, y + 8, 11, muted);
  y += 18;
  put('天气助手 · Weather Studio　' + iso, P, y + 8, 11, muted);
  y += 26;

  // 裁掉预留的多余高度：上面所有步长都是动态累加的，不该写死画布高度
  const out = document.createElement('canvas');
  out.width = cv.width; out.height = Math.round(y * dpr);
  out.getContext('2d').drawImage(cv, 0, 0, cv.width, out.height, 0, 0, out.width, out.height);
  flash('正在生成图片…');
  out.toBlob(async blob => {
    if (!blob) { flash('图片导出失败，可改用「复制文本」'); return; }
    flash(await saveBlob(blob, 'fortune-' + iso + '.png', '今日运势 · ' + iso));
  }, 'image/png');
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
