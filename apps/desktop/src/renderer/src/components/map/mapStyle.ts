// Màu cụm và cỡ nút/cạnh của thẻ Bản đồ. Màu cụm chỉ để phân biệt, không mang ý nghĩa như màu ngữ nghĩa.
export const PALETTE = ['#3257f0', '#0a9c99', '#7a4df2', '#e23d94', '#e0a100', '#1c9a5b', '#e07a00', '#2b9be0', '#b0522d', '#5d6685']

export const communityColor = (c: number | null, palette = PALETTE, muted = '#9aa5b1'): string =>
  c == null ? muted : palette[((c % palette.length) + palette.length) % palette.length]

export const nodeSize = (files: number): number => Math.min(28, Math.max(4, 4 + 2 * Math.sqrt(files)))

export const edgeSize = (weight: number): number => Math.min(6, 0.5 + Math.log2(1 + weight) / 2)
