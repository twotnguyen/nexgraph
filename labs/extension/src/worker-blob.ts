// Webview không tạo được Worker từ URL tài nguyên: URL đó khác origin, và chỉ trang (không phải worker) được
// service worker của webview phục vụ. Nên trang tự tải mã worker rồi chạy nó từ một blob cùng origin.
// Mỗi worker phải là một file tự chứa (vite đã gộp sẵn ELK và worker của Monaco như vậy).
type Args = Parameters<Worker['postMessage']>
const Native = window.Worker
window.Worker = function (url: string | URL, opts?: WorkerOptions): Worker {
  const proxy = new EventTarget() as Worker
  const queue: Args[] = [] // thông điệp gửi trước khi worker thật sẵn sàng
  let real: Worker | null = null
  let dead = false
  fetch(String(url))
    .then((r) => r.text())
    .then((src) => {
      if (dead) return
      real = new Native(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), opts)
      real.onmessage = (e) => { proxy.onmessage?.(e); proxy.dispatchEvent(new MessageEvent('message', { data: e.data })) }
      real.onerror = (e) => proxy.onerror?.(e)
      for (const a of queue) real.postMessage(...a)
    })
    .catch((e) => proxy.onerror?.(new ErrorEvent('error', { message: String(e) })))
  proxy.postMessage = ((...a: Args): void => void (real ? real.postMessage(...a) : queue.push(a))) as Worker['postMessage']
  proxy.terminate = (): void => { dead = true; real?.terminate() }
  return proxy
} as unknown as typeof Worker
