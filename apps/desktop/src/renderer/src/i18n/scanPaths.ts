import { relative } from 'node:path'

/**
 * Đường dẫn trong luật quét (`ALLOWED[].file`, `BOUNDARY`) viết bằng `/`, còn `relative()` trả
 * `components\agent\AgentPanel.tsx` trên Windows — so thẳng thì test quét đỏ trên CI windows dù
 * mã đúng (review #57 C1). Chuẩn hoá mọi đường dẫn trước khi so.
 */
export const toPosix = (path: string): string => path.replace(/\\/g, '/')

/** Đường dẫn tương đối từ `root` tới `file`, luôn dùng `/` trên mọi hệ điều hành. */
export const relPosix = (root: string, file: string): string => toPosix(relative(root, file))
