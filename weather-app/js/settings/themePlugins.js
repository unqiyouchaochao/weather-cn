/* 设置分组「主题插件」：导入 / 列出 / 删除用户自制的 .json 主题包。
 *
 * 这一组不往 cfg 里写任何东西 —— 选中哪套主题归「单位与外观」那组的 themeSel 管，
 * 这里只管「有哪些可选」。所以它没有 read()，也就不会参与保存失败的回滚。
 *
 * 两处顺序是硬的，写反了就是隐性 bug：
 * ① 导入/删除之后必须先 refreshPluginIndex() 再 rebuildThemeOptions()，
 *    否则下拉里出现的是一项注册表里查不到的 id，themeById 会静默兜底回 THEMES[0]
 *    （用户看到的是「选了没反应」）。
 * ② 删掉的如果正是当前用的那套，要先把 cfg.theme 落到同侧默认再重画，
 *    不然 body 上还挂着已删主题的令牌与 <style>，而它已经不在任何清单里了。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { defaultOf } from '../lib/themes.js';
import { list, importPkg, remove, refreshPluginIndex } from '../lib/themePlugin.js';
import { rebuildThemeOptions } from './appearance.js';
import * as ui from '../ui.js';

let lastErrors = [];

function repaint() {
  const items = list();
  const cur = loadConfig().theme;
  if (!items.length) {
    /* 带 id 是规矩，不是装饰：回归里那条「设置面板不许有写死的 .hint」放的正是
     * 「带 id 的动态提示」这一类（notifyHint / alertHint 同列）。这一条按清单空不空决定出没出现，
     * 属于那一类；不给 id 就是往面板里塞一段固定说明。 */
    el.pluginList.innerHTML = lastErrors.length ? errBlock()
      : '<p class="hint" id="pluginEmpty">还没有导入过主题。怎么导入、什么样的会被拒，写在下面「软件声明 · 主题插件」那一条里。</p>';
    return;
  }
  el.pluginList.innerHTML = (lastErrors.length ? errBlock() : '') + items.map(p =>
    '<div class="plugin-row">' +
      '<span class="plugin-name">' + esc(p.label) + '</span>' +
      '<span class="plugin-meta">' + esc(p.id) + ' · ' + (p.base === 'dark' ? '深色' : '浅色') +
        (p.assetNames && p.assetNames.length ? ' · ' + p.assetNames.length + ' 图' : '') +
        (cur === p.id ? ' · 使用中' : '') + '</span>' +
      '<button type="button" class="tool-btn plugin-del" data-del="' + esc(p.id) + '">删除</button>' +
    '</div>').join('');
}

/* 校验错误原样列出来。这里不折叠、不「详见日志」—— 用户要的就是那句「哪对配色、比值多少」，
 * 折起来等于让他猜。 */
function errBlock() {
  return '<div class="plugin-err"><b>没能导入</b><ul>' +
    lastErrors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
}

async function onPick(ev) {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';                 // 不清的话，改完同一个文件再选一次不会触发 change
  if (!f) return;
  let pkg;
  try {
    const text = await f.text();
    pkg = JSON.parse(text);
  } catch (e) {
    lastErrors = ['文件读不出一个合法的 JSON：' + e.message];
    repaint();
    ui.showStatus('主题包解析失败', true);
    return;
  }
  const r = await importPkg(pkg);
  if (!r.ok) {
    lastErrors = r.errors;
    repaint();
    ui.showStatus('这个主题包不合格，没导入（下面列了原因）', true);
    return;
  }
  lastErrors = [];
  refreshPluginIndex();
  rebuildThemeOptions();
  repaint();
  ui.showStatus(r.warns && r.warns.length ? r.warns[0] : '已导入「' + pkg.label + '」，在「主题」里选它');
}

async function onDelete(id) {
  const items = list();
  const rec = items.find(p => p.id === id);
  if (!rec) return;
  await remove(id);
  refreshPluginIndex();
  /* 正在用的就是它：先落回同侧默认再重画 —— 顺序反了 applyTheme 会拿已删的注册项去下发令牌 */
  const cfg = loadConfig();
  if (cfg.theme === id) {
    cfg.theme = defaultOf(rec.base);
    if (rec.base === 'dark') cfg.darkTheme = cfg.theme; else cfg.lightTheme = cfg.theme;
    saveConfig(cfg);
    ui.applyTheme(cfg.theme);
  }
  rebuildThemeOptions();
  repaint();
  ui.showStatus('已删除主题「' + rec.label + '」');
}

export default {
  build() {
    el.pluginFile.addEventListener('change', onPick);
    /* 列表每次重画，事件挂在容器上走委托：给每个按钮单独 addEventListener
     * 会在下一次 repaint 后全数失效（节点已经被 innerHTML 换掉了）。 */
    el.pluginList.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-del]');
      if (btn) onDelete(btn.dataset.del);
    });
    repaint();
  },
  fill() { lastErrors = []; repaint(); }
};
