/* 一个极小的 IndexedDB 键值封装 —— 目前只有主题插件的图片素材用它。
 *
 * 为什么不用 localStorage：插件的图片是二进制，一个带立绘的包 2.1MB。localStorage 通常按源给 5~10MB，
 * 而本项目已经拿它存 config / geo / alerts 这些**承重**缓存，
 * 且现有约定是配额满了就 `catch {}` 静默退化成内存态（见各 lib 的 lsSet）。
 * 那种静默退化对配置无所谓，对「用户导入的主题」是灾难：刷新一次主题就没了，还不报错。
 * 所以图片走 IDB（原生存 Blob，顺带省掉 base64 那 33% 膨胀），localStorage 只留轻量的令牌与 CSS。
 *
 * IDB 也可能打不开（无痕模式、存储被清、用户拒绝持久化）。这里不假装能兜住，
 * 只把失败如实抛给调用方，由 themePlugin 决定「图片没了但配色照样能用」。 */
const DB_NAME = 'weather-studio';
const DB_VER = 1;

let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('这个 WebView 没有 indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      /* 一张表一个用途，建表逻辑集中在这里；以后加表只动这一处 */
      for (const s of ['plugin-assets']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('打不开 indexedDB'));
    req.onblocked = () => rej(new Error('indexedDB 被别的标签页占住'));
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error || new Error('IDB 事务失败'));
    t.onabort = () => rej(t.error || new Error('IDB 事务被中止'));
  });
}

export const idbGet = (store, key) => tx(store, 'readonly', s => s.get(key));
export const idbSet = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
export const idbDel = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const idbKeys = store => tx(store, 'readonly', s => s.getAllKeys());
