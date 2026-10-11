/* 屏幕上那几行「说话的小字」：状态行（一格，三种东西抢）、搜索框下面的经纬度、右上角的原地刷新转圈。
 * 谁可以改我：改「提示怎么排队」的人。要往状态行里加一种新消息，先看下面那条优先级。 */
import { el } from '../lib/dom.js';
import { esc } from '../lib/util.js';

/* 状态行只有一格，却有三种东西要写：查错的报错、钉住给用户的入口、一次性的进度提示。
 * 优先级必须是「报错 > 钉住 > 空」。以前 pinStatus 无条件覆盖，实测冷启动那条
 * 「系统定位没开…已先用网络定位顶着」会把紧随其后的「查询失败 + 重试」整条顶掉（#109）——
 * 用户既看不到失败，也丢了唯一的重试入口。 */
let pinned = null, errLine = null;
export function showStatus(msg, isErr, retryFn, action) {
  if (isErr) errLine = { msg, retryFn };
  else errLine = null;          // 明确写了另一条（进度提示）就是有意替换，旧的报错不再挡路
  el.status.innerHTML = esc(msg) +
    (retryFn ? ' <button class="retry" id="statusRetry">重试</button>' : '') +
    (action ? ' <button class="retry" id="statusAction">' + esc(action.label) + '</button>' : '');
  el.status.className = 'status ' + (isErr ? 'err' : 'ok');
  el.status.hidden = false;
  const rb = document.getElementById('statusRetry');
  if (rb) rb.onclick = retryFn;
  const ab = document.getElementById('statusAction');
  if (ab) ab.onclick = action.onClick;
}
/**
 * 钉住的提示：普通状态行每次渲染都会被清掉（query 成功就 hideStatus），
 * 而「系统定位没开 + 去开启」这条必须一直挂在屏幕上，否则用户点完设置回来就找不到了。
 * 但它在报错还在屏幕上的时候不许插队 —— 只登记，等报错被清掉再由 hideStatus 补画。
 */
export function pinStatus(msg, action) {
  pinned = { msg, action };
  if (!errLine || el.status.hidden) showStatus(msg, false, null, action);
}
export function unpinStatus() {
  pinned = null;
  el.status.hidden = true;
}
/* hideStatus 只管「这一行别再占着」：报错记录的清账全在 showStatus 一处（写下非报错的那一刻就翻页），
 * 这里再清一遍是重复的 —— 两个出口改同一份状态，早晚对不上。
 * 所以这一路留着一条判据就够：屏幕已经空着时，pinStatus 那条 `el.status.hidden` 直接放行。 */
export function hideStatus() {
  if (pinned) { showStatus(pinned.msg, false, null, pinned.action); return; }
  el.status.hidden = true;
}

/** 搜索框下面那行经纬度：框里的字查完就清空（见 query.js），当前在哪儿靠这一行看 */
export function setCoords(lat, lon) {
  const ok = lat != null && lon != null && isFinite(Number(lat)) && isFinite(Number(lon));
  el.coordLine.hidden = !ok;
  if (ok) el.coordLine.textContent = '经纬度 ' + Number(lat).toFixed(4) + ', ' + Number(lon).toFixed(4);
}

/* 原地刷新的可见反馈：右上角小转圈。亮在 query() 里（判到是同一目标才亮），灭在 render 与
 * renderError 两个出口 —— 挂在出口上就不必自己维护「哪一轮最后落地」：过期结果提前 return
 * 时不会把别人那一轮的转圈抢灭。 */
export function setSyncing(on) { el.syncDot.hidden = !on; }
