/* falsify 变异表里属于「settings」的那一族。
 * 为什么一张表拆成几份：MUT 是「每条新功能都必须改同一个文件」的第三处 —— 两条改动线各加一条
 * 断言就要往同一个 ]; 前面插一行，抢同一个位置、同一份上下文（前两处是 ui.js 与 main.js，已分片）。
 * 加一处变异 = 在归属那一族加一条；一条断言盯两个族的文件就写成两条，各进各的族。
 * 两条规矩没变：① name 开头写 `vNNN `，falsify 靠它把比这棵树新的条目筛掉；
 * ② from 必须在目标文件里**恰好命中 1 次** —— 改完跑 `node tools/anchor-audit.mjs`，一秒出失锚条数，
 *   不必等那一整趟两小时的全量逼红。 */
import { F } from '../files.mjs';

export default [
  { name: 'v95 渲染时丢掉正文首尾两段', file: F.setDisc, from: "d.lines.map(t => '<p>'", to: "d.lines.slice(1, -1).map(t => '<p>'", expect: '正文一段都不许在渲染时丢掉' },
  { name: 'v95 这一组默认就展开', file: F.setDisc, from: "'<details class=\"disc\" data-d=\"'", to: "'<details open class=\"disc\" data-d=\"'", expect: '这一组默认全收起' },
  { name: 'v100 保存后又直接改 modal.hidden（绕过出口，锁解不掉）', file: F.setIdx, from: '  closeSettings();\n  ui.applyTheme(cfg.theme);', to: '  el.modal.hidden = true;\n  ui.applyTheme(cfg.theme);', expect: '点「保存并应用」关面板走的是同一个出口' },
  { name: 'v105 重开设置干脆不归零滚动区（停在上次看的位置）', file: F.setIdx, from: '  el.modalBody.scrollTop = 0;', to: '  void el.modalBody;', expect: '面板回到从头看起' },
  { name: 'v105 归零归到了不滚的那一层（.modal 自己不出滚动条）', file: F.setIdx, from: '  el.modalBody.scrollTop = 0;', to: '  el.modal.scrollTop = 0;', expect: '面板回到从头看起' },
  /* ↓ 2026-10-31 从 v139 基石捞回：设置里通知/预警那两行说明必须跟着当前选中的源改口，
   *   判据住在注册表的 cap.background / cap.alert 两个位上。两条各拦一半：
   *   一条拦「源明明给不出预警还说跟着报文核对」，一条拦「切回中国天气时漏掉后台那半句」。 */
  { name: '捞回 不给预警的源仍然说「跟着报文一起核对」（骗人那句回来了）', file: F.setAlerts,
    from: '当前这一源不给气象预警，页面上不会出现那一栏',
    to: '当前这一源的预警跟着天气那一发一起核对',
    expect: '说明要直说这一栏不会出现' },
  { name: '捞回 切回中国天气时漏掉「每 10 分钟盯预警」那半句', file: F.setAlerts,
    from: "'划掉后台后每 10 分钟自取一次专盯预警。'",
    to: "''",
    expect: '这两句要回得来' },
];
